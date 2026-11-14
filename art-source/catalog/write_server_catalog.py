"""Rewrites the PETS / MOUNTS tables in server/season.py and the pet / mount offers in server/shop.py from
cosmetic_catalog.py (arg: server folder)."""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cosmetic_catalog as cat  # noqa: E402

root = pathlib.Path(sys.argv[1])

# season.py: id → (name, sheet) for pets; id → (name, sheet, saddle) for mounts
s = (root / "season.py").read_text(encoding="utf-8")
pets = "PETS: dict[str, tuple[str, str]] = {\n" + "".join(f'    "{k}": ("{n}", "{k}"),\n' for k, _m, _g, n, *_ in cat.PETS) + "}\n"
mounts = ("MOUNTS: dict[str, tuple[str, str, float]] = {  # name, sheet, saddle height (share of the animal's height)\n"
          + "".join(f'    "{k}": ("{n}", "{k}", {cat.MOUNT_MODELS[m][5]}),\n' for k, m, _g, n, *_ in cat.MOUNTS) + "}\n")
s, n1 = re.subn(r"PETS: dict\[str, tuple\[str, str\]\] = \{\n.*?\n\}\n", pets, s, flags=re.S)
s, n2 = re.subn(r"MOUNTS: dict\[str, tuple\[str, str\]\] = \{\n.*?\n\}\n", mounts, s, flags=re.S)
assert n1 == 1 and n2 == 1, (n1, n2)
s = s.replace('''    return [{"id": mid, "name": nm, "sheet": sheet} for mid, (nm, sheet) in MOUNTS.items()]''',
              '''    return [{"id": mid, "name": nm, "sheet": sheet, "saddle": saddle} for mid, (nm, sheet, saddle) in MOUNTS.items()]''')
(root / "season.py").write_text(s, encoding="utf-8")

# shop.py: replace every pet / mount offer line pair with the generated ones
sh = (root / "shop.py").read_text(encoding="utf-8")
start = sh.index("    # mounts: ride a horse")
end = sh.index("    # time savers")
before, after = sh[:start], sh[end:]
# drop the old pet block too
p0 = before.index("    # mascots: follow the hero")
before = before[:p0]
block = "    # mascots: follow the hero, looks only\n"
for k, _m, _g, _n, price, desc in cat.PETS:
    block += f'    {{"id": "{k}", "kind": "pet", "ref": "{k}", "price": {price}, "tab": "mascotes", "desc": "{desc}"}},\n'
block += "    # mounts: ride them, looks only (no speed)\n"
for k, _m, _g, _n, price, desc in cat.MOUNTS:
    block += f'    {{"id": "{k}", "kind": "mount", "ref": "{k}", "price": {price}, "tab": "montarias", "desc": "{desc}"}},\n'
(root / "shop.py").write_text(before + block + after, encoding="utf-8")
print(len(cat.PETS), "pets,", len(cat.MOUNTS), "mounts")
