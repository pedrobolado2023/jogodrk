"""Writes the 20 mounts and 20 mascots into art-source/units.json (arg: path to units.json). Prints the keys that
are new (not rendered yet), so only those go to Blender."""
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cosmetic_catalog as cat  # noqa: E402

p = pathlib.Path(sys.argv[1])
sprites = p.parent.parent / "client" / "public" / "sprites"
u = json.loads(p.read_text(encoding="utf-8"))
for key, model, grade, name, *_ in cat.MOUNTS + cat.EXCLUSIVE_MOUNTS:
    path, anims, h, ortho, size, _saddle = cat.MOUNT_MODELS[model]
    e = {"_note": f"montaria: {name}", "source": "glb", "path": path, "height": h, "ortho": ortho, "size": size,
         "center": 0.4, "anims": {"idle": anims["idle"]}}  # the shop picture only: riding uses ride_<class>_<mount>
    if model == "drake":
        e["frames"] = {"idle": 8, "walk": 8, "run": 8}  # big frames: fewer of them
    if grade:
        e["grade"] = cat.GRADES[grade]
    u[key] = e
for key, model, grade, name, *_ in cat.PETS:
    path, anims, h, ortho, size, center = cat.PET_MODELS[model]
    e = {"_note": f"mascote: {name}", "source": "glb", "path": path, "height": h, "ortho": ortho, "size": size,
         "center": center, "anims": anims}
    if grade:
        e["grade"] = cat.GRADES[grade]
    u[key] = e
p.write_text(json.dumps(u, ensure_ascii=False, indent=2), encoding="utf-8")
new = [k for k, *_ in cat.MOUNTS + cat.EXCLUSIVE_MOUNTS + cat.PETS if not (sprites / k / "idle.png").exists()]
print(" ".join(new))
