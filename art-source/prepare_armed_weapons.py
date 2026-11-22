"""Takes the weapons exactly where the user placed them (Projeto personagem/personagem armado/<name> armado.glb, where
each weapon hangs from an "Encaixe_*" anchor under a Mixamo hand bone) and moves them onto the same Mixamo body that
Unreal already uses (<name> mixamo.fbx), bound 100% to that hand bone. Each weapon becomes its own skinned FBX on the
class skeleton, so the game can draw it with the body's pose and swap it for a skin later.

  blender -b --factory-startup -P art-source/prepare_armed_weapons.py -- <armado.glb> <mixamo.fbx> <out_dir> <key> [tris]

Writes <out_dir>/SK_W_<key>_<slot>.fbx and T_W_<key>_<slot>.png (slot: right / left). Outputs stay out of git.
"""
import os
import sys
from pathlib import Path
import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, FBX, OUT, KEY = argv[0], argv[1], Path(argv[2]), argv[3]
TRIS = int(argv[4]) if len(argv) > 4 else 8000
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def unscaled(m):
    loc, rot, _ = m.decompose()
    return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()


def bone_world(arm, name):
    # the rest (bind) matrix: the pose channels still hold the Mixamo clip's frame even with pose_position REST
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def height(arm):
    bs = arm.data.bones
    hips = next(b for b in bs if b.name.lower().endswith("hips")); head = next(b for b in bs if b.name.lower().endswith("head"))
    return ((arm.matrix_world @ head.head_local) - (arm.matrix_world @ hips.head_local)).length


# 1) the user's armed scene: where every weapon sits relative to its hand
bpy.ops.import_scene.gltf(filepath=GLB)
glb_objs = list(bpy.data.objects)
arm_a = next(o for o in glb_objs if o.type == "ARMATURE" and any(b.name.endswith("RightHand") for b in o.data.bones))
for o in glb_objs:   # rest the scene so the hand and the weapon are read in one consistent pose
    if o.type == "ARMATURE":
        o.animation_data_clear() if o.animation_data else None
        o.data.pose_position = "REST"
bpy.context.view_layer.update()
h_a = height(arm_a)
weapons = []
for o in glb_objs:
    if o.type != "MESH" or any(m.type == "ARMATURE" for m in o.modifiers):
        continue
    p = o
    while p is not None and not (p.parent_type == "BONE" and p.parent_bone):
        p = p.parent
    if p is None:
        continue
    bone = p.parent_bone
    side = "right" if "right" in bone.lower() else "left"
    rel = unscaled(bone_world(arm_a, bone)).inverted() @ o.matrix_world
    weapons.append((o, side, rel))
names_a = [(o.name, s) for o, s, _ in weapons]

# 2) the body Unreal uses (same Mixamo rig): put each weapon on its hand, scaled by the body-size ratio
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=FBX, automatic_bone_orientation=False)
new = [o for o in bpy.data.objects if o not in before]
for a in list(bpy.data.actions):
    a.use_fake_user = False
arm_b = next(o for o in new if o.type == "ARMATURE")
arm_b.animation_data_clear() if arm_b.animation_data else None
body = [o for o in new if o.type == "MESH"]
# same fix as rescale_mixamo_body.py: a body that reads ~1.8 tall gets x100 so FBX_SCALE_ALL lands in centimetres
zs = [(body[0].matrix_world @ v.co).z for v in body[0].data.vertices]
if max(zs) - min(zs) < 10:
    for o in [o for o in new if o.parent is None]:
        o.scale = tuple(s * 100 for s in o.scale)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in new:
        if o.type in ("ARMATURE", "MESH"):
            o.select_set(True)
    bpy.context.view_layer.objects.active = arm_b
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# Unreal's bodies are BODY_CM tall (import_base_heroes): bring this scene's skeleton to that size too, or the
# weapons come out small (the body here reads ~100 after the fix above)
BODY_CM = float(__import__("os").environ.get("DF_BODY_CM", "180"))
from mathutils import Vector
arm_b.data.pose_position = "REST"
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(c) for o in body for c in o.bound_box]
tall = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
k = BODY_CM / tall
for o in [o for o in new if o.parent is None]:
    o.scale = tuple(s * k for s in o.scale)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for o in new:
    if o.type in ("ARMATURE", "MESH"):
        o.select_set(True)
bpy.context.view_layer.objects.active = arm_b
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
r = height(arm_b) / h_a
report = [f"{KEY} ratio={r:.4f} weapons={names_a}"]

for o, side, rel in weapons:
    bone_b = next(b.name for b in arm_b.data.bones if b.name.lower().endswith(f"{side}hand"))
    loc, rot, sc = rel.decompose()
    rel_b = Matrix.Translation(loc * r) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal((sc.x * r, sc.y * r, sc.z * r, 1))
    w = o.copy(); w.data = o.data.copy(); bpy.context.scene.collection.objects.link(w)
    w.parent = None
    w.matrix_world = unscaled(bone_world(arm_b, bone_b)) @ rel_b
    bpy.ops.object.select_all(action="DESELECT"); w.select_set(True); bpy.context.view_layer.objects.active = w
    tris = sum(len(p.vertices) - 2 for p in w.data.polygons)
    d = w.modifiers.new("Reduce", "DECIMATE"); d.ratio = min(1.0, TRIS / max(1, tris))
    bpy.ops.object.modifier_apply(modifier=d.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # DF_ARMED_MIRROR=1: the user's tool only had a right-hand anchor besides the shield; a bow belongs in the left hand
    # (the archer clips draw with the right). Mirror it across the body's middle (the rig is symmetric) onto the left.
    if os.environ.get("DF_ARMED_MIRROR") == "1" and side == "right":
        bones = arm_b.data.bones
        xr = (arm_b.matrix_world @ next(b for b in bones if b.name.lower().endswith("righthand")).head_local).x
        xl = (arm_b.matrix_world @ next(b for b in bones if b.name.lower().endswith("lefthand")).head_local).x
        xc = (xr + xl) / 2
        for v in w.data.vertices:
            v.co.x = 2 * xc - v.co.x
        w.data.flip_normals(); w.data.update()
        side = "left"; bone_b = next(b.name for b in bones if b.name.lower().endswith("lefthand"))
    # DF_ARMED_SCALE: grow the weapon around the palm (the hand bone's tail), so the grip stays in the hand
    k_scale = float(os.environ.get("DF_ARMED_SCALE", "1"))
    if k_scale != 1:
        palm = arm_b.matrix_world @ arm_b.data.bones[bone_b].tail_local
        for v in w.data.vertices:
            v.co = palm + (v.co - palm) * k_scale
        w.data.update()
    # texture of this weapon, saved beside the FBX for the Unreal material
    img = next((n.image for s in w.material_slots if s.material and s.material.use_nodes
                for n in s.material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
    if img:
        img.save(filepath=str(OUT / f"T_W_{KEY}_{side}.png"))   # packed in the GLB: write a copy beside the FBX
    # bound 100% to the hand bone
    vg = w.vertex_groups.new(name=bone_b); vg.add(range(len(w.data.vertices)), 1.0, "REPLACE")
    mw = w.matrix_world.copy(); w.parent = arm_b; w.matrix_world = mw; m = w.modifiers.new("Armature", "ARMATURE"); m.object = arm_b
    w.name = f"SK_W_{KEY}_{side}"
    bpy.ops.object.select_all(action="DESELECT"); w.select_set(True); arm_b.select_set(True)
    bpy.context.view_layer.objects.active = arm_b
    out = OUT / f"SK_W_{KEY}_{side}.fbx"
    bpy.ops.export_scene.fbx(filepath=str(out), use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False,
                             bake_anim=False, apply_scale_options="FBX_SCALE_ALL", path_mode="STRIP",
                             primary_bone_axis="Y", secondary_bone_axis="X")
    zs = [v.co.z for v in w.data.vertices]
    report.append(f"  {side}: bone={bone_b} tris={sum(len(p.vertices) - 2 for p in w.data.polygons)} "
                  f"z={min(zs):.1f}..{max(zs):.1f} tex={'sim' if img else 'nao'}")
    w.hide_set(True)
import os
if os.environ.get("DF_ARMED_PREVIEW"):   # debug: front view of the body with its weapons, in this scene
    from mathutils import Vector
    for o in bpy.data.objects:
        o.hide_render = not (o in body or o.name.startswith("SK_W_")); o.hide_set(False)
    shown = [o for o in bpy.data.objects if not o.hide_render and o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in shown for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    sc = bpy.context.scene; sc.render.engine = "BLENDER_WORKBENCH"; sc.render.resolution_x = sc.render.resolution_y = 700
    c = (lo + hi) / 2; size = max(hi - lo)
    for i, v in enumerate([(0, -1, 0), (1, 0, 0)]):
        cam = bpy.data.objects.new("C", bpy.data.cameras.new("C")); sc.collection.objects.link(cam)
        cam.data.type = "ORTHO"; cam.data.ortho_scale = size * 1.1; cam.location = c + Vector(v) * size * 3
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Z").to_euler(); sc.camera = cam
        sc.render.filepath = os.environ["DF_ARMED_PREVIEW"] + f"_{i}.png"; bpy.ops.render.render(write_still=True)
    report.append(f"  bounds {lo} {hi}")
print("ARMED", " | ".join(report))
(OUT / f"report_{KEY}.txt").write_text("\n".join(report), encoding="utf-8")
