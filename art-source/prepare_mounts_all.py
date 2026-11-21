"""Runs prepare_mounts.py (Blender) for the mounted GLBs: every one, or only the mounts named on the command line.

  python art-source/prepare_mounts_all.py                 (all 63)
  python art-source/prepare_mounts_all.py mount_horse mount_wolf

Output: modelos-montados-3d/unreal/<class>_<mount id>.fbx plus sizes.json (bounding sizes reported by Blender).
"""
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "modelos-montados-3d"
OUT = SRC / "unreal"
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
CLASS = {"mestre-da-lamina": "blade_master", "grande-feiticeiro": "grand_sorcerer", "patrulheiro-noturno": "night_ranger"}


def run(item):
    cls = CLASS[item["arquivo"].split("/")[0]]
    out = OUT / f"{cls}_{item['idMontaria']}.fbx"
    if out.exists() and out.stat().st_mtime > (SRC / item["arquivo"]).stat().st_mtime:
        return out.name, "pronto"
    r = subprocess.run([BLENDER, "-b", "--factory-startup", "-P", str(HERE / "prepare_mounts.py"), "--", str(SRC / item["arquivo"]), str(out)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"MOUNT_SIZE \(([^)]*)\)", r.stdout)
    if not m or not out.exists():
        return out.name, "ERRO " + (r.stderr or r.stdout)[-400:]
    return out.name, [float(v) for v in m.group(1).split(",")]


def main():
    OUT.mkdir(exist_ok=True)
    wanted = set(sys.argv[1:])
    items = [i for i in json.loads((SRC / "indice.json").read_text(encoding="utf-8"))["modelos"] if not wanted or i["idMontaria"] in wanted]
    sizes_file = OUT / "sizes.json"
    sizes = json.loads(sizes_file.read_text(encoding="utf-8")) if sizes_file.exists() else {}
    with ThreadPoolExecutor(4) as pool:
        for name, result in pool.map(run, items):
            print(name, result, flush=True)
            if isinstance(result, list):
                sizes[name[:-4]] = result
    sizes_file.write_text(json.dumps(sizes, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
