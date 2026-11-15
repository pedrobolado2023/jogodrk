"""Writes the 63 "hero seated on a mount" units (art-source/modelos-montados-3d, see its indice.json) into
art-source/units.json as ride_<class>_<mount>, framed from the mount's own framing (cosmetic_catalog.MOUNT_MODELS)
with room for the rider. Prints the keys that are not rendered yet. Arg: path to units.json."""
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cosmetic_catalog as cat  # noqa: E402

CLASSES = {"Mestre da Lâmina": "blade_master", "Grande Feiticeiro": "grand_sorcerer", "Patrulheiro Noturno": "night_ranger"}
QUATERNIUS = {"idle": "Montaria — Idle", "walk": "Montaria — Walk", "run": "Montaria — Gallop"}
DRAKE = {"idle": "Montaria — idle_loop", "walk": "Montaria — walk_loop", "run": "Montaria — walk_loop"}  # as the plain drake


def key_of(cls: str, mount: str) -> str:
    return f"ride_{cls}_{mount}"


def main() -> None:
    units_path = pathlib.Path(sys.argv[1])
    folder = units_path.parent / "modelos-montados-3d"
    index = json.loads((folder / "indice.json").read_text(encoding="utf-8"))
    model_of = {k: m for k, m, *_ in cat.MOUNTS + cat.EXCLUSIVE_MOUNTS}
    units = json.loads(units_path.read_text(encoding="utf-8"))
    sprites = units_path.parent.parent / "client" / "public" / "sprites"
    new = []
    for m in index["modelos"]:
        cls, mount = CLASSES[m["personagem"]], m["idMontaria"]
        model = model_of.get(mount)
        if not model:
            print(f"ignorado (montaria fora do catálogo): {m['arquivo']}", file=sys.stderr)
            continue
        _path, _anims, height, ortho, size, _saddle = cat.MOUNT_MODELS[model]
        drake = model == "drake"
        e = {
            "_note": f"montado: {m['personagem']} em {m['montaria']}",
            "source": "mounted",
            "path": f"modelos-montados-3d/{m['arquivo']}",
            "height": height,                         # the animal's height: same size as the plain mount
            "ortho": round(ortho * (0.8 if drake else 1.08), 2),  # horses: more room above, for the rider
            "size": int(round(size * (1.05 if drake else 1.2) / 8) * 8),
            "center": 0.45 if drake else 0.55,
            "rider_scale": 1.3 if drake else 1.5,     # heroes are drawn larger than life next to their mounts
            "exposure": 0.6, "ambient": 0.5,          # between the mounts' light and the heroes' (dark armour)
            "anims": DRAKE if drake else QUATERNIUS,
            "frames": {"idle": 8, "walk": 8, "run": 8} if drake else {"idle": 10},
        }
        if drake:
            e["rider_offset"] = [0, 1.0, 0.75]        # the export sinks the rider into the drake's neck
            e["ortho"] = ortho                        # the long tail needs the plain drake's framing
        k = key_of(cls, mount)
        units[k] = e
        if not (sprites / k / "idle.png").exists():
            new.append(k)
    units_path.write_text(json.dumps(units, ensure_ascii=False, indent=2), encoding="utf-8")
    print(" ".join(new))


if __name__ == "__main__":
    main()
