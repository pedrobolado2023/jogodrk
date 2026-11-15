"""
Engine test: every active skill of every class runs without errors and does what its kind promises.
Run: .venv/Scripts/python.exe -m pytest test_skills.py -q   (or plain python test_skills.py)
"""

from __future__ import annotations

import asyncio
import time

from game import Game, Hero
from skills_data import BASICS, SKILLS, passives_for, skills_for
from websocket_manager import PlayerSession, manager


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, msg: dict) -> None:
        self.sent.append(msg)


async def _noop_save(_hero: Hero) -> None:
    return None


def _hero(game: Game, cls: str, map_id: str, x: float, y: float, level: int = 12) -> tuple[Hero, FakeWS]:
    ws = FakeWS()
    cid = f"test_{cls}_{map_id}"
    manager.sessions[cid] = PlayerSession(ws=ws, char_id=cid, char_name=cid, map_id=map_id, x=x, y=y)
    manager.get_grid(map_id).add(cid, x, y)
    hero = Hero(char_id=cid, name=cid, cls=cls, level=level, exp=0, gold=0, story={"q": 0, "st": "offer", "n": 0}, map_id=map_id)
    hero.refresh_passives()
    hero.hp, hero.mp = hero.max_hp, hero.max_mp
    game.heroes[cid] = hero
    return hero, ws


async def run_all() -> None:
    game = Game(_noop_save)
    for cls in ("blade_master", "grand_sorcerer", "night_ranger"):
        assert len(skills_for(cls)) == 10, cls
        assert len(passives_for(cls)) == 5, cls
        mm = game.mobs["forest_01"]
        target = next(m for m in mm.mobs.values() if m.mob_def_id == "wolf")
        hero, ws = _hero(game, cls, "forest_01", target.x + 1.0, target.y)
        for sk in skills_for(cls):
            hero.mp = hero.max_mp
            hero.cooldowns.clear()
            for m in mm.mobs.values():
                m.hp, m.is_dead, m.stun_until = m.max_hp, False, 0.0
            s = manager.sessions[hero.char_id]
            s.x, s.y = target.x + 1.0, target.y
            ws.sent.clear()
            err = await game.use_skill(hero, sk["id"], target.instance_id, target.x, target.y)
            assert err is None, f"{sk['id']}: {err}"
            used = [m for m in ws.sent if m["type"] == "skill_used"]
            assert used, f"{sk['id']}: no skill_used event"
            if sk["kind"] not in ("buff", "heal") and not (sk["kind"] == "blink" and not sk["radius"]):
                assert any(m["type"] == "mob_damaged" for m in ws.sent), f"{sk['id']}: hit nothing"
            if sk["kind"] == "buff":
                assert any(b.id == sk["id"] for b in hero.buffs), f"{sk['id']}: no buff"
            if sk["kind"] in ("blink", "dash"):
                assert "blink" in used[0] or "dash" in used[0], f"{sk['id']}: did not move"
            if sk.get("cc") and sk["kind"] != "buff":
                assert any(m["type"] == "cc" for m in ws.sent), f"{sk['id']}: no crowd control"
            again = await game.use_skill(hero, sk["id"], target.instance_id, target.x, target.y)
            assert again == "on_cooldown", f"{sk['id']}: cooldown not applied ({again})"
        # the basic attack: free, quick, weaker than the first skill, not one of the 10 slots
        basic = next(b for b in BASICS if b["cls"] == cls)
        assert basic["id"] not in {sk["id"] for sk in skills_for(cls)} and basic["mp"] == 0 and basic["lvl"] == 1
        assert basic["power"] < skills_for(cls)[0]["power"] and basic["cd"] <= 800
        hero.mp, hero.cooldowns = 0, {}
        for m in mm.mobs.values():
            m.hp, m.is_dead, m.stun_until = m.max_hp, False, 0.0
        ws.sent.clear()
        assert await game.use_skill(hero, basic["id"], target.instance_id, target.x, target.y) is None
        assert any(m["type"] == "mob_damaged" for m in ws.sent) and hero.mp == 0, f"{basic['id']}: hit nothing"
        locked = Hero(char_id="lowbie", name="l", cls=cls, level=1, exp=0, gold=0, story={}, map_id="forest_01")
        top = skills_for(cls)[-1]
        assert await game.use_skill(locked, top["id"], None, None, None) == "locked"
        print(f"ok  {cls}: 10 ativas + 5 passivas")

    # DoTs tick and the boss telegraphs its slam
    await game.tick_dots(time.monotonic() + 60)
    boss = next(m for m in game.mobs["dungeon_01"].mobs.values() if m.boss)
    events = game.mobs["dungeon_01"].tick({"p": (boss.x, boss.y + 2)}, 0.1)
    assert any(e["type"] == "boss_warn" for e in events), "boss did not warn"
    print("ok  chefão avisa antes do golpe em área")

    # PvP only in the arena, and the safe zone blocks fighting
    a, _ = _hero(game, "blade_master", "arena_01", 15, 15)
    b, bws = _hero(game, "night_ranger", "arena_01", 16, 15)
    assert await game.use_skill(a, "bm_slash", b.char_id, None, None) is None
    assert b.hp < b.max_hp and any(m["type"] == "damage" for m in bws.sent), "pvp damage missing"
    t, _ = _hero(game, "blade_master", "town_01", 20, 20)
    assert await game.use_skill(t, "bm_twisting_slash", None, None, None) == "safe_zone"
    print("ok  PvP na arena e vila segura")


if __name__ == "__main__":
    asyncio.run(run_all())


def test_all_skills() -> None:
    asyncio.run(run_all())
