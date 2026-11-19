"""Export each map's layout (what the server knows about where things are) as JSON for the Unreal client.

The Unreal editor scripts read these files to place portals, NPCs, monster hunting areas, hidden places, landmarks
and the clearings that must stay free of trees, all at the same tile coordinates the server uses
(1 tile = 200 Unreal units).

    .venv\\Scripts\\python.exe export_layout.py <output folder> [map_id ...]

Writes <output folder>/<map_id>.json. With no map ids, exports every map. Nothing secret goes in: only fixed
world data that /meta and map_info already send to every player.
"""
import json
import sys
from pathlib import Path

import discovery
import world_data as w

# The forest camp at the town portal is drawn by the browser client only (client/src/gfx/world.ts, CAMP).
# Kept here so the Unreal forest gets it in the same place. Update both if it moves.
CAMPS = {
    "forest_01": {
        "center": [20.6, 42.2],
        "fire": [20.5, 42.5],
        "braziers": [[23.6, 46.6], [18.6, 46.2]],
        "props": [
            {"kind": "tent", "x": 17.4, "y": 40.6, "scale": 1}, {"kind": "tent", "x": 20.2, "y": 38.9, "scale": 0.9},
            {"kind": "logseat", "x": 19.3, "y": 43.8, "scale": 1}, {"kind": "logseat", "x": 21.8, "y": 41.4, "scale": 1},
            {"kind": "crate", "x": 24.0, "y": 40.6, "scale": 1}, {"kind": "crate", "x": 24.6, "y": 41.3, "scale": 0.9},
            {"kind": "barrel", "x": 23.3, "y": 39.9, "scale": 1}, {"kind": "banner", "x": 17.8, "y": 44.4, "scale": 1},
        ],
    },
}


def layout(map_id: str) -> dict:
    m = w.MAPS[map_id]
    spawns = []
    for sp in w.SPAWNS:
        if sp["map"] != map_id:
            continue
        mob = w.MOBS[sp["mob"]]
        spawns.append({"mob": sp["mob"], "name": mob["name"], "level": mob["level"], "boss": bool(mob.get("boss")),
                       "x": sp["x"], "y": sp["y"], "count": sp["count"], "wander": sp["wander"]})
    places = [{k: p[k] for k in ("id", "name", "x", "y", "look", "glow", "landmark") if k in p}
              for p in discovery.PLACES.get(map_id, [])]
    return {
        "map_id": map_id,
        "name": m["name"],
        "theme": m["theme"],
        "size": m["size"],
        "safe": m["safe"],
        "pvp": m["pvp"],
        "level": m["level"],
        "spawn": m.get("spawn"),
        "portals": [{k: p[k] for k in ("id", "x", "y", "to", "label") if k in p} for p in m["portals"]],
        "npcs": m["npcs"],
        "clearings": [{"x": c[0], "y": c[1], "r": c[2]} for c in m.get("clearings", [])],
        "spawns": spawns,
        "places": places,
        "camp": CAMPS.get(map_id),
        "units": {"tile_uu": 200, "note": "x, y in tiles; Unreal X = x*200, Y = y*200"},
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[2:] or list(w.MAPS)
    for map_id in ids:
        if map_id not in w.MAPS:
            sys.exit(f"unknown map: {map_id}")
        (out / f"{map_id}.json").write_text(json.dumps(layout(map_id), ensure_ascii=False, indent=1), encoding="utf-8")
        print("wrote", out / f"{map_id}.json")


if __name__ == "__main__":
    main()
