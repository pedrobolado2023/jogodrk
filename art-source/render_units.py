"""
Renders rigged 3D characters into isometric 8-direction sprite sheets for the game.

    blender -b --factory-startup -P art-source/render_units.py -- [unit_key ...] [--preview]

Reads art-source/units.json. Writes client/public/sprites/<key>/<anim>.png (rows = 8 screen directions,
clockwise from east; columns = frames) and merges an entry into client/public/sprites/manifest.json.
--preview renders only frame 0 of the first animation, for checking framing and facing.
--only idle,walk re-renders just those animations and keeps the others in the manifest.
"""

import glob
import json
import math
import os
import re
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ART = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ART)
OUT = os.path.join(ROOT, "client", "public", "sprites")
GAME_PX_PER_METER = 44.0  # a 1.8 m hero stands ~80 world px tall in the game

# Mixamo file names → game animation (first match wins)
MIXAMO_KEYWORDS = {
    "idle": r"idle|breathing",
    "walk": r"walk",
    "run": r"run|sprint|jog",
    "attack": r"slash|attack|punch|swing|stab|bite|strike|shoot|recoil|aim",
    "cast": r"magic|spell|cast|power",
    "hit": r"hit|impact|react|damage",
    "death": r"dying|death|die|dead",
}
LOOPING = {"idle", "walk", "run", "ride"}
DEFAULT_FRAMES = {"idle": 10, "walk": 10, "run": 10, "attack": 10, "cast": 10, "hit": 6, "death": 10}
FPS = {"ride": 8, "idle": 8, "walk": 12, "run": 14, "attack": 16, "cast": 14, "hit": 14, "death": 12}
IDLE_MAX_FRAMES = 16
IDLE_MIN_FPS = 5


def log(*a):
    print("[render]", *a, flush=True)


def import_file(path):
    before = set(bpy.data.objects)
    low = path.lower()
    if low.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    elif low.endswith(".fbx"):
        try:
            bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=True)
        except Exception:
            bpy.ops.wm.fbx_import(filepath=path)
    else:
        raise ValueError(f"formato não suportado: {path}")
    return [o for o in bpy.data.objects if o not in before]


def set_action(arm, act):
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if hasattr(ad, "action_slot") and getattr(act, "slots", None):
        ad.action_slot = act.slots[0]


# "ride": a seated pose made from the idle (units with "ride": true). The rider sits still: the upper body is frozen
# on the idle's first frame and kept upright (the hips and spine lose the idle's crouch and lean), and the legs sit
# astride the saddle — thighs forward and only a little open, knees bent so the shins hang down the horse's flanks.
# Degrees, Euler XYZ in each bone's local space (Mixamo rig); the right side mirrors Y and Z.
RIDE_POSE = {"UpLeg": [-80, 0, 12], "Leg": [88, 0, 0], "Foot": [-18, 0, 0]}
RIDE_UPRIGHT = ("Hips", "Spine", "Spine1", "Spine2")  # bones that lose the idle's motion (back to their rest pose)


def action_fcurves(act):
    """All F-curves of an action, for both the old flat API and Blender 4.4+ layered actions."""
    try:
        if act.fcurves is not None:
            return list(act.fcurves)
    except AttributeError:
        pass
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out += list(bag.fcurves)
    return out


def ride_action(arm, idle, u):
    """A copy of the idle without leg motion, and the leg bones posed seated (kept, since nothing animates them)."""
    pose = u.get("ride_pose", RIDE_POSE)
    legs = {}
    for pb in arm.pose.bones:
        short = pb.name.split(":")[-1]
        for part, (rx, ry, rz) in pose.items():
            for side, mirror in (("Left", 1), ("Right", -1)):
                if short == side + part:
                    legs[pb.name] = (math.radians(rx), math.radians(ry * mirror), math.radians(rz * mirror))
    act = idle.copy()
    act.name = idle.name + "_ride"
    act.use_fake_user = True
    start = act.frame_range[0]
    for fc in action_fcurves(act):
        m = re.search(r'pose\.bones\["([^"]+)"\]', fc.data_path)
        bone = m.group(1) if m else ""
        short = bone.split(":")[-1]
        hide = short in u.get("ride_hide", [])  # props that make no sense on a horse (the archer's loose arrow)
        if hide or (bone in legs and "rotation" in fc.data_path) or (short in RIDE_UPRIGHT and ("rotation" in fc.data_path or short == "Hips")):
            fc.mute = True  # posed below (legs) or back to the rest pose (upright hips and spine)
            continue
        # everything else holds the idle's first frame: the rider does not sway while the horse walks
        v = fc.evaluate(start)
        for kp in fc.keyframe_points:
            kp.co[1] = v
            kp.handle_left[1] = v
            kp.handle_right[1] = v
    for pb in arm.pose.bones:
        if pb.name.split(":")[-1] in u.get("ride_hide", []):
            pb.scale = (0.0, 0.0, 0.0)  # the mesh weighted to it shrinks away
        if pb.name.split(":")[-1] in RIDE_UPRIGHT:
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    for name, rot in legs.items():
        pb = arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Euler(rot, "XYZ").to_quaternion()
    if not legs:
        log("aviso: ossos das pernas não encontrados para a pose montada")
    return act


def delete(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


# "mounted" units (art-source/modelos-montados-3d): one GLB with a hero already seated on a mount — the mount's
# armature plays the animations, the hero's armature hangs from an anchor on the mount's back and holds its seated
# clip. Filled by load_unit for render_unit: the object to turn (the whole hierarchy) and the mount's meshes (sizing).
MOUNTED = {}


def _ancestors(o):
    while o.parent:
        o = o.parent
        yield o


def load_mounted(key, u):
    objs = import_file(os.path.join(ART, u["path"]))
    arms = [o for o in objs if o.type == "ARMATURE"]
    rider = next((a for a in arms if any(x.name.startswith("Encaixe") for x in _ancestors(a))), None)
    mount = next(a for a in arms if a is not rider)
    if rider:
        # the seated pose comes as imported: its clip only holds rest keys, so assigning it would undo the seat
        if rider.animation_data:
            rider.animation_data.action = None
        # the game draws heroes larger than life next to their mounts (1.85 m hero, 1.6 m horse): grow the rider
        # around the saddle anchor so he reads as the same hero as on foot
        anchor = next(x for x in _ancestors(rider) if x.name.startswith("Encaixe"))
        hips = next((pb for pb in rider.pose.bones if re.search(r"hips|pelvis", pb.name, re.I)), rider.pose.bones[0])
        bpy.context.view_layer.update()
        seat = rider.matrix_world @ hips.head  # where the GLB sits him: the hips stay there, he grows around them
        anchor.scale = anchor.scale * u.get("rider_scale", 1.0)
        bpy.context.view_layer.update()
        rider.matrix_world = Matrix.Translation(seat - rider.matrix_world @ hips.head) @ rider.matrix_world
        if u.get("rider_offset"):  # the drakes' export sinks the rider into the body: lift him onto the back
            bpy.context.view_layer.update()
            rider.matrix_world = Matrix.Translation(Vector(u["rider_offset"])) @ rider.matrix_world
    actions = {}
    for name, act in u["anims"].items():
        if act in bpy.data.actions:
            actions[name] = bpy.data.actions[act]
        else:
            log(f"{key}: ação '{act}' não encontrada")
    owners = [mount] + ([rider] if rider else [])
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(x in owners for x in _ancestors(o))]
    delete([o for o in bpy.data.objects if o.type == "MESH" and o not in meshes])  # stray spheres and the like
    root = mount
    for x in _ancestors(mount):
        root = x
    MOUNTED.clear()
    MOUNTED.update(root=root, mount_meshes=[o for o in meshes if rider not in _ancestors(o)])
    log(f"{key}: montado ({len(meshes)} malhas), animações {sorted(actions)}")
    return mount, meshes, actions


def load_unit(key, u):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    actions = {}
    if u["source"] == "mounted":
        return load_mounted(key, u)
    if u["source"] == "glb":
        objs = import_file(os.path.join(ART, u["path"]))
        arm = next(o for o in objs if o.type == "ARMATURE")
        for name, act in u["anims"].items():
            if act in bpy.data.actions:
                actions[name] = bpy.data.actions[act]
            else:
                log(f"{key}: ação '{act}' não encontrada")
    else:
        folder = os.path.join(ART, u["dir"])
        files = sorted(glob.glob(os.path.join(folder, "*.fbx")))
        if not files:
            raise FileNotFoundError(f"nenhum .fbx em {folder}")
        pattern = {**MIXAMO_KEYWORDS, **u.get("anims", {})}
        is_anim = lambda f: any(re.search(rx, os.path.basename(f), re.I) for rx in pattern.values())
        body = next((f for f in files if re.search(u.get("body", r"character|t.?pose|model"), os.path.basename(f), re.I)),
                    next((f for f in files if not is_anim(f)), files[0]))
        objs = import_file(body)
        arm = next(o for o in objs if o.type == "ARMATURE")
        used = {body}
        for name, rx in pattern.items():
            f = next((f for f in files if f not in used and re.search(rx, os.path.basename(f), re.I)), None)
            if not f:
                continue
            used.add(f)
            extra = import_file(f)
            other = next((o for o in extra if o.type == "ARMATURE"), None)
            act = other.animation_data.action if other and other.animation_data else None
            if act:
                act.use_fake_user = True
                act.name = f"{key}_{name}"
                actions[name] = act
            delete(extra)
        if "idle" not in actions and arm.animation_data and arm.animation_data.action:
            actions["idle"] = arm.animation_data.action
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and (o.parent == arm or any(
        m.type == "ARMATURE" and m.object == arm for m in o.modifiers))]
    delete([o for o in bpy.data.objects if o.type == "MESH" and o not in meshes] +
           [o for o in bpy.data.objects if o.type not in ("MESH", "ARMATURE")])
    log(f"{key}: animações {sorted(actions)}")
    return arm, meshes, actions


def hips_bone(arm, u):
    if u.get("root_bone") and u["root_bone"] in arm.pose.bones:
        return arm.pose.bones[u["root_bone"]]
    for pb in arm.pose.bones:
        if re.search(r"hips|pelvis", pb.name, re.I):
            return pb
    return arm.pose.bones[0]


def world_bounds(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in meshes:
        e = m.evaluated_get(dg)
        pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def setup_scene(u, size, ortho, target_z):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    sc.view_settings.exposure = u.get("exposure", 0.3)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    amb = u.get("ambient", 0.06)
    world.node_tree.nodes["Background"].inputs[0].default_value = (amb * 0.9, amb * 0.95, amb * 1.2, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = world

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.rotation_euler = Euler((math.radians(60), 0, math.radians(45)))
    fwd = cam.rotation_euler.to_matrix() @ Vector((0, 0, -1))
    cam.location = Vector((0, 0, target_z)) - fwd * 20
    cam_data.clip_end = 100
    sc.camera = cam

    cam_rot = cam.rotation_euler.to_matrix().to_4x4()
    def sun(name, energy, color, local):
        d = bpy.data.lights.new(name, "SUN")
        d.energy = energy
        d.color = color
        d.angle = math.radians(8)
        o = bpy.data.objects.new(name, d)
        o.matrix_world = cam_rot @ local
        sc.collection.objects.link(o)
    # key: moonlight from the upper left of the screen; rim: from behind; fill: warm, low, from the right
    sun("key", 3.2, (0.92, 0.94, 1.0), Matrix.Rotation(math.radians(-38), 4, "Y") @ Matrix.Rotation(math.radians(-28), 4, "X"))
    sun("rim", 4.5, (0.62, 0.72, 1.0), Matrix.Rotation(math.radians(160), 4, "X"))
    sun("fill", 0.9, (1.0, 0.78, 0.6), Matrix.Rotation(math.radians(55), 4, "Y"))


def grade(frame, g):
    """Color-grade a rendered frame: desaturate by g['desat'], multiply by g['tint'], scale by g['gain']."""
    rgb = frame[..., :3]
    lum = (rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    rgb = rgb + (lum - rgb) * g.get("desat", 0.0)
    rgb = rgb * np.array(g.get("tint", [1, 1, 1]), dtype=np.float32) * g.get("gain", 1.0)
    frame[..., :3] = np.clip(rgb, 0, 1)
    return frame


def compose(paths, rows, cols, size, out, g=None):
    sheet = np.zeros((rows * size, cols * size, 4), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            img = bpy.data.images.load(paths[r][c])
            px = np.empty(size * size * 4, dtype=np.float32)
            img.pixels.foreach_get(px)
            bpy.data.images.remove(img)
            frame = px.reshape(size, size, 4)[::-1]
            if g:
                frame = grade(frame, g)
            sheet[r * size:(r + 1) * size, c * size:(c + 1) * size] = frame
    h, w = sheet.shape[:2]
    out_img = bpy.data.images.new("sheet", w, h, alpha=True)
    out_img.pixels.foreach_set(sheet[::-1].ravel())
    out_img.filepath_raw = out
    out_img.file_format = "PNG"
    out_img.save()
    bpy.data.images.remove(out_img)


def render_unit(key, u, preview=False, only=None):
    arm, meshes, actions = load_unit(key, u)
    if u.get("ride") and "idle" in actions and (only is None or "ride" in only):
        actions = {**actions, "ride": None}  # built after the framing (it changes the legs)
    pivot = bpy.data.objects.new("pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    mounted = u["source"] == "mounted"
    (MOUNTED["root"] if mounted else arm).parent = pivot  # mounted: the whole hierarchy turns, rider included
    first = actions.get("idle") or next(a for a in actions.values() if a)
    set_action(arm, first)
    bpy.context.scene.frame_set(int(first.frame_range[0]))
    # mounted: sized by the mount alone, so the animal keeps the size of the plain mount and the rider follows
    x0, x1, y0, y1, z0, z1 = world_bounds(MOUNTED["mount_meshes"] if mounted else meshes)
    height = u.get("height", 1.8)
    scale = height / max(1e-4, z1 - z0)
    pivot.scale = (scale, scale, scale)
    pivot.location.z = -z0 * scale
    size = u.get("size", 192)
    ortho = u.get("ortho", height * 1.5)
    target_z = height * u.get("center", 0.45)
    setup_scene(u, size, ortho, target_z)
    hips = hips_bone(arm, u)
    sc = bpy.context.scene
    tmp = tempfile.mkdtemp(prefix=f"spr_{key}_")
    dest = os.path.join(OUT, key)
    os.makedirs(dest, exist_ok=True)
    facing = math.radians(u.get("facing", 0))
    manifest_anims = {}

    for name, act in actions.items():
        if only and name not in only:
            continue
        if name == "ride":
            act = ride_action(arm, actions["idle"], u)
        set_action(arm, act)
        start, end = act.frame_range
        loop = name in LOOPING
        fps = FPS.get(name, 12)
        n = u.get("frames", {}).get(name, DEFAULT_FRAMES.get(name, 10))
        if name in ("idle", "ride"):
            # Idle should breathe at (close to) real speed: more frames for long clips, and a lower
            # fps so 10 frames of a 5 s clip don't play in 1 s. Capped by IDLE_MAX_FRAMES (memory).
            dur = max(0.1, (end - start) / sc.render.fps)
            if name not in u.get("frames", {}):
                n = max(n, min(IDLE_MAX_FRAMES, round(dur * 4)))
            fps = round(min(FPS["idle"], max(IDLE_MIN_FPS, n / dur)), 2)
        frames = [start + (end - start) * i / (n if loop else max(1, n - 1)) for i in range(n)]
        if preview:
            frames = frames[:1]
        paths = []
        for r in range(8):
            pivot.rotation_euler.z = math.radians(135 - 45 * r) + facing
            pivot.location.x = pivot.location.y = 0
            def hips_xy(f):
                sc.frame_set(int(f), subframe=f - int(f))
                bpy.context.view_layer.update()
                p = arm.matrix_world @ hips.head
                return p.x, p.y
            hs = hips_xy(frames[0])
            he = hips_xy(frames[-1])
            row = []
            for i, f in enumerate(frames):
                t = i / max(1, len(frames) - 1)
                ox = hs[0] + (he[0] - hs[0]) * t if loop else hs[0]
                oy = hs[1] + (he[1] - hs[1]) * t if loop else hs[1]
                pivot.location.x, pivot.location.y = -ox, -oy
                sc.frame_set(int(f), subframe=f - int(f))
                path = os.path.join(tmp, f"{name}_{r}_{i}.png")
                sc.render.filepath = path
                bpy.ops.render.render(write_still=True)
                pivot.location.x = pivot.location.y = 0
                row.append(path)
            paths.append(row)
            if preview:
                break
        if preview:
            compose([paths[0]], 1, 1, size, os.path.join(dest, f"_preview_{name}.png"), u.get("grade"))
            log(f"{key}: prévia salva")
            return
        compose(paths, 8, len(frames), size, os.path.join(dest, f"{name}.png"), u.get("grade"))
        manifest_anims[name] = {"frames": len(frames), "fps": fps, "loop": loop}
        log(f"{key}: {name} ({len(frames)} quadros × 8 direções)")

    origin_y = 0.5 + target_z * math.cos(math.radians(30)) / ortho
    path = os.path.join(OUT, "manifest.json")
    # several Blender processes may render at once: take a lock file around read-modify-write of the manifest
    lock = path + ".lock"
    import time as _time
    for _ in range(600):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            _time.sleep(0.1)
    else:
        fd = None  # a stale lock: go ahead anyway
    try:
        manifest = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        if only and key in manifest:  # partial re-render: keep the other animations' entries
            manifest_anims = {**manifest[key]["anims"], **manifest_anims}
        # "v": render time — the client adds it to the image URLs, so a re-rendered sheet is never served from a stale cache
        manifest[key] = {"size": size, "originY": round(origin_y, 4), "scale": round(GAME_PX_PER_METER * ortho / size, 4),
                         "height": height, "anims": manifest_anims, "v": int(_time.time())}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1, ensure_ascii=False)
    finally:
        if fd is not None:
            os.close(fd)
            os.remove(lock)
    log(f"{key}: pronto")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    preview = "--preview" in argv
    only = None
    if "--only" in argv:  # --only idle,walk → re-render just these animations
        i = argv.index("--only")
        only = set(argv[i + 1].split(","))
        argv = argv[:i] + argv[i + 2:]
    wanted = [a for a in argv if not a.startswith("--")]
    cfg = json.load(open(os.path.join(ART, "units.json"), encoding="utf-8"))
    for key, u in cfg.items():
        if key.startswith("_") or (wanted and key not in wanted):
            continue
        if u["source"] == "mixamo" and not glob.glob(os.path.join(ART, u["dir"], "*.fbx")):
            log(f"{key}: pulando (sem arquivos em {u['dir']})")
            continue
        render_unit(key, u, preview, only)


main()
