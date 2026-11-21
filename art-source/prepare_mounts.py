"""Turns the user's mounted GLBs (modelos-montados-3d: hero seated on an animal, two skeletons) into FBX files for the
Unreal client: one skinned mesh on the animal's skeleton, the seated hero weighted to the saddle bone (so it rides
with the gallop), only the idle / walk / run clips, the heavy weapon meshes reduced.

  blender -b --factory-startup -P art-source/prepare_mounts.py -- <src.glb> <out.fbx> [preview.png]

Run for many files with art-source/prepare_mounts_all.py. The FBX files stay out of git (licensed source models).
"""
import math
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else ""
RIDER_MAX_VERTS = 10 ** 9   # no reduction: the decimated hero looked cracked next to the hero on foot
CLIPS = {"Idle": ("idle_loop", "idle"), "Walk": ("walk_loop", "walk"), "Run": ("gallop", "fly_loop", "run")}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
rider_arm = next(a for a in arms if any(b.name.startswith("mixamorig") for b in a.data.bones))
animal = next(a for a in arms if a is not rider_arm)
seat = next((o for o in bpy.data.objects if o.name.startswith("Encaixe")), None)
seat_bone = seat.parent_bone if seat and seat.parent_bone else "Back"

# the animal at rest: the seat sits on its bone the same way in every pose
if animal.animation_data:
    animal.animation_data.action = None
animal.data.pose_position = "REST"
if rider_arm.animation_data:
    rider_arm.animation_data.action = None   # the 'Personagem' clip only holds rest keys and would undo the seat
bpy.context.view_layer.update()

# freeze the seated hero into plain meshes (world space)
dg = bpy.context.evaluated_depsgraph_get()
frozen = []
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.parent is rider_arm]:
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    obj = bpy.data.objects.new(o.name + "_seated", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = ev.matrix_world.copy()
    frozen.append(obj)
for o in [o for o in bpy.data.objects if (o.type == "MESH" and (o.parent is rider_arm or o.parent is None) and o not in frozen)]:
    bpy.data.objects.remove(o, do_unlink=True)   # the hero's skinned meshes and stray helper spheres
bpy.data.objects.remove(rider_arm, do_unlink=True)

# only the very dense props (the blade master's sword: ~40k vertices) are reduced; the body stays whole
for o in frozen:
    if len(o.data.vertices) > 15000:
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
        d = o.modifiers.new("Reduce", "DECIMATE")
        d.ratio = 5000 / len(o.data.vertices)
        bpy.ops.object.modifier_apply(modifier=d.name)
# the seated hero is drawn with the hero's own materials in the game: export its slots without the texture copies
for o in frozen:
    for mat in o.data.materials:
        if mat and mat.use_nodes:
            for n in [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"]:
                mat.node_tree.nodes.remove(n)

bpy.ops.object.select_all(action="DESELECT")
for o in frozen:
    o.select_set(True)
bpy.context.view_layer.objects.active = frozen[0]
bpy.ops.object.join()
rider = bpy.context.view_layer.objects.active
rider.name = "Rider"
verts = len(rider.data.vertices)
if verts > RIDER_MAX_VERTS:
    d = rider.modifiers.new("Reduce", "DECIMATE")
    d.ratio = RIDER_MAX_VERTS / verts
    bpy.ops.object.modifier_apply(modifier=d.name)

# smooth shading on the animal (it came flat-shaded, faceted next to the hero); hard edges kept above 45 degrees
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.parent is animal]:
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(45), keep_sharp_edges=True)

# weight the hero to the saddle bone of the animal
world = rider.matrix_world.copy()
rider.parent = animal
rider.matrix_world = world
vg = rider.vertex_groups.new(name=seat_bone)
vg.add(range(len(rider.data.vertices)), 1.0, "REPLACE")
mod = rider.modifiers.new("Armature", "ARMATURE")
mod.object = animal

# keep three clips, named Idle / Walk / Run
chosen = {}
for a in bpy.data.actions:
    low = a.name.lower().split("|")[-1].split("— ")[-1].strip()
    for clip, names in CLIPS.items():
        if low in names and (clip not in chosen or "|" in a.name):
            chosen[clip] = a
for a in list(bpy.data.actions):
    if a not in chosen.values():
        bpy.data.actions.remove(a)
for clip, a in chosen.items():
    a.name = clip
    a.use_fake_user = True
animal.data.pose_position = "POSE"
if animal.animation_data is None:
    animal.animation_data_create()
animal.animation_data.action = chosen.get("Idle")

# keep only what the FBX needs
keep = {animal, rider} | {o for o in bpy.data.objects if o.type == "MESH" and o.parent is animal}
for o in list(bpy.data.objects):
    if o not in keep and o.type != "EMPTY":
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
for o in keep:
    o.select_set(True)
bpy.ops.export_scene.fbx(filepath=OUT, use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False,
                         bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
                         bake_anim_force_startend_keying=True, apply_scale_options="FBX_SCALE_ALL", use_armature_deform_only=False,
                         path_mode="COPY", embed_textures=True)

# report sizes (world) so the client can size the mount
pts = []
dg = bpy.context.evaluated_depsgraph_get()
for o in keep:
    if o.type == "MESH":
        ev = o.evaluated_get(dg)
        m = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in m.vertices]
        ev.to_mesh_clear()
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
# the seated hero's height (body only: weapons can stick out) sets the scale in the game, so riders match heroes on foot
body = [v.co for v in rider.data.vertices]
rz = [(rider.matrix_world @ v).z for v in body]
rider_h = sorted(rz)[int(len(rz) * .985)] - min(rz)
print("MOUNT_SIZE", tuple(round(v, 3) for v in (hi - lo)) + (round(rider_h, 3),), "rider_verts", len(rider.data.vertices), "clips", sorted(chosen), "bone", seat_bone)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    scene.display.shading.color_type = "MATERIAL"
    c = (lo + hi) / 2
    size = max(hi - lo)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 1.15
    cam.location = c + Vector((size * 2, -size * 1.2, size * .5))
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
