"""
Seed script — populates the database with maps, mobs, skills and spawn points.
Run once: python seed.py
"""

import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import DATABASE_URL
from models import Base, MapDef, MobDef, MobSpawn, SkillDef, CharacterClass

_engine_kw = {}
if "sqlite" in DATABASE_URL:
    _engine_kw["connect_args"] = {"check_same_thread": False}

engine = create_async_engine(DATABASE_URL, **_engine_kw)
async_session = async_sessionmaker(engine, expire_on_commit=False)


MAPS = [
    {"id": "town_01", "name": "Ravencrest Village", "is_safe_zone": True, "level_min": 1, "level_max": 99,
     "width": 200, "height": 200, "connections": [{"map_id": "forest_01", "portal_x": 195, "portal_y": 100, "dest_x": 5, "dest_y": 100}]},
    {"id": "forest_01", "name": "Darkwood Forest", "is_safe_zone": False, "level_min": 1, "level_max": 15,
     "width": 200, "height": 200, "connections": [
         {"map_id": "town_01", "portal_x": 5, "portal_y": 100, "dest_x": 195, "dest_y": 100},
         {"map_id": "swamp_01", "portal_x": 195, "portal_y": 100, "dest_x": 5, "dest_y": 100},
     ]},
    {"id": "swamp_01", "name": "Cursed Swamplands", "is_safe_zone": False, "level_min": 10, "level_max": 25,
     "width": 200, "height": 200, "connections": [{"map_id": "forest_01", "portal_x": 5, "portal_y": 100, "dest_x": 195, "dest_y": 100}]},
    {"id": "dungeon_01", "name": "Skeleton Catacombs", "is_safe_zone": False, "level_min": 20, "level_max": 40,
     "width": 150, "height": 150, "connections": [{"map_id": "swamp_01", "portal_x": 100, "portal_y": 195, "dest_x": 75, "dest_y": 5}]},
]

MOBS = [
    # Forest mobs (level 1-15)
    {"id": "wolf", "name": "Shadow Wolf", "level": 3, "hp": 80, "atk": 8, "def": 3,
     "exp_reward": 25, "gold_reward_min": 2, "gold_reward_max": 8, "aggro_radius": 5.0, "respawn_ms": 15000,
     "loot_table": [{"item_def_id": "wolf_pelt", "drop_rate": 0.3, "qty_min": 1, "qty_max": 1}]},
    {"id": "goblin", "name": "Forest Goblin", "level": 5, "hp": 120, "atk": 12, "def": 5,
     "exp_reward": 40, "gold_reward_min": 5, "gold_reward_max": 15, "aggro_radius": 6.0, "respawn_ms": 20000,
     "loot_table": [{"item_def_id": "goblin_ear", "drop_rate": 0.25, "qty_min": 1, "qty_max": 2}]},
    {"id": "treant", "name": "Corrupted Treant", "level": 10, "hp": 300, "atk": 20, "def": 15,
     "exp_reward": 100, "gold_reward_min": 10, "gold_reward_max": 30, "aggro_radius": 4.0, "respawn_ms": 45000,
     "loot_table": [{"item_def_id": "ancient_bark", "drop_rate": 0.15, "qty_min": 1, "qty_max": 1}]},
    # Swamp mobs (level 10-25)
    {"id": "swamp_crawler", "name": "Swamp Crawler", "level": 12, "hp": 200, "atk": 18, "def": 10,
     "exp_reward": 80, "gold_reward_min": 8, "gold_reward_max": 20, "aggro_radius": 7.0, "respawn_ms": 20000,
     "loot_table": [{"item_def_id": "slime_essence", "drop_rate": 0.2, "qty_min": 1, "qty_max": 3}]},
    {"id": "bog_witch", "name": "Bog Witch", "level": 18, "hp": 250, "atk": 30, "def": 8,
     "exp_reward": 150, "gold_reward_min": 15, "gold_reward_max": 40, "aggro_radius": 8.0, "respawn_ms": 30000,
     "loot_table": [{"item_def_id": "witch_staff", "drop_rate": 0.05, "qty_min": 1, "qty_max": 1}]},
    # Dungeon mobs (level 20-40)
    {"id": "skeleton_warrior", "name": "Skeleton Warrior", "level": 22, "hp": 400, "atk": 35, "def": 20,
     "exp_reward": 200, "gold_reward_min": 20, "gold_reward_max": 50, "aggro_radius": 6.0, "respawn_ms": 25000,
     "loot_table": [{"item_def_id": "bone_fragment", "drop_rate": 0.35, "qty_min": 1, "qty_max": 2}]},
    {"id": "death_knight", "name": "Death Knight", "level": 35, "hp": 1200, "atk": 60, "def": 40,
     "exp_reward": 500, "gold_reward_min": 50, "gold_reward_max": 150, "aggro_radius": 8.0, "respawn_ms": 120000,
     "loot_table": [
         {"item_def_id": "dark_blade", "drop_rate": 0.03, "qty_min": 1, "qty_max": 1},
         {"item_def_id": "bone_fragment", "drop_rate": 0.5, "qty_min": 2, "qty_max": 5},
     ]},
]

SKILLS = [
    # Blade Master
    {"id": "bm_twisting_slash", "name": "Twisting Slash", "char_class": CharacterClass.BLADE_MASTER,
     "description": "Spins weapons dealing physical AoE damage", "max_level": 5, "level_req": 1,
     "cooldown_ms": 2000, "mp_cost": 8, "damage_base": 15, "damage_scaling": 1.5, "scaling_stat": "str",
     "aoe_radius": 3.0, "range": 1.5, "duration_ms": 0, "extra": {}},
    {"id": "bm_charge", "name": "Charge", "char_class": CharacterClass.BLADE_MASTER,
     "description": "Dashes to target, stunning for 1.5s", "max_level": 5, "level_req": 5,
     "cooldown_ms": 12000, "mp_cost": 15, "damage_base": 25, "damage_scaling": 1.2, "scaling_stat": "str",
     "aoe_radius": 0.0, "range": 8.0, "duration_ms": 1500, "extra": {"stun_ms": 1500}},
    {"id": "bm_blood_aura", "name": "Blood Aura", "char_class": CharacterClass.BLADE_MASTER,
     "description": "Party HP buff + 5% lifesteal", "max_level": 5, "level_req": 10,
     "cooldown_ms": 30000, "mp_cost": 20, "damage_base": 0, "damage_scaling": 0.0, "scaling_stat": "str",
     "aoe_radius": 0.0, "range": 0.0, "duration_ms": 30000, "extra": {"lifesteal": 0.05}},
    # Grand Sorcerer
    {"id": "gs_meteor_strike", "name": "Meteor Strike", "char_class": CharacterClass.GRAND_SORCERER,
     "description": "Massive fire AoE with burn DoT", "max_level": 5, "level_req": 1,
     "cooldown_ms": 8000, "mp_cost": 25, "damage_base": 40, "damage_scaling": 2.0, "scaling_stat": "int",
     "aoe_radius": 4.0, "range": 10.0, "duration_ms": 6000, "extra": {"dot_ticks": 4}},
    {"id": "gs_mana_shield", "name": "Mana Shield", "char_class": CharacterClass.GRAND_SORCERER,
     "description": "Absorbs 30% damage from MP", "max_level": 5, "level_req": 5,
     "cooldown_ms": 25000, "mp_cost": 15, "damage_base": 0, "damage_scaling": 0.0, "scaling_stat": "int",
     "aoe_radius": 0.0, "range": 0.0, "duration_ms": 15000, "extra": {"mana_shield": 0.30}},
    {"id": "gs_frost_nova", "name": "Frost Nova", "char_class": CharacterClass.GRAND_SORCERER,
     "description": "Freezes all enemies in radius for 2s", "max_level": 5, "level_req": 10,
     "cooldown_ms": 15000, "mp_cost": 20, "damage_base": 20, "damage_scaling": 1.0, "scaling_stat": "int",
     "aoe_radius": 5.0, "range": 0.0, "duration_ms": 2000, "extra": {"freeze_ms": 2000}},
    # Night Ranger
    {"id": "nr_piercing_arrow", "name": "Piercing Arrow", "char_class": CharacterClass.NIGHT_RANGER,
     "description": "Line AoE passing through enemies", "max_level": 5, "level_req": 1,
     "cooldown_ms": 3000, "mp_cost": 10, "damage_base": 20, "damage_scaling": 1.8, "scaling_stat": "agi",
     "aoe_radius": 1.0, "range": 12.0, "duration_ms": 0, "extra": {"pierce": True}},
    {"id": "nr_shadow_step", "name": "Shadow Step", "char_class": CharacterClass.NIGHT_RANGER,
     "description": "Blink backward + poison trap", "max_level": 5, "level_req": 5,
     "cooldown_ms": 10000, "mp_cost": 12, "damage_base": 10, "damage_scaling": 0.8, "scaling_stat": "agi",
     "aoe_radius": 2.0, "range": 0.0, "duration_ms": 6000, "extra": {"poison_ticks": 3}},
    {"id": "nr_eagle_eye", "name": "Eagle Eye", "char_class": CharacterClass.NIGHT_RANGER,
     "description": "Boost crit rate and attack range", "max_level": 5, "level_req": 10,
     "cooldown_ms": 20000, "mp_cost": 15, "damage_base": 0, "damage_scaling": 0.0, "scaling_stat": "agi",
     "aoe_radius": 0.0, "range": 0.0, "duration_ms": 20000, "extra": {"crit_bonus": 0.15}},
]

SPAWNS = [
    # Forest spawns
    {"map_id": "forest_01", "mob_def_id": "wolf", "pos_x": 30, "pos_y": 50, "count": 5, "wander_radius": 4.0},
    {"map_id": "forest_01", "mob_def_id": "wolf", "pos_x": 80, "pos_y": 80, "count": 4, "wander_radius": 3.0},
    {"map_id": "forest_01", "mob_def_id": "goblin", "pos_x": 60, "pos_y": 120, "count": 6, "wander_radius": 5.0},
    {"map_id": "forest_01", "mob_def_id": "goblin", "pos_x": 140, "pos_y": 60, "count": 4, "wander_radius": 4.0},
    {"map_id": "forest_01", "mob_def_id": "treant", "pos_x": 150, "pos_y": 150, "count": 2, "wander_radius": 3.0},
    # Swamp spawns
    {"map_id": "swamp_01", "mob_def_id": "swamp_crawler", "pos_x": 40, "pos_y": 40, "count": 6, "wander_radius": 5.0},
    {"map_id": "swamp_01", "mob_def_id": "swamp_crawler", "pos_x": 120, "pos_y": 80, "count": 5, "wander_radius": 4.0},
    {"map_id": "swamp_01", "mob_def_id": "bog_witch", "pos_x": 100, "pos_y": 160, "count": 3, "wander_radius": 6.0},
    # Dungeon spawns
    {"map_id": "dungeon_01", "mob_def_id": "skeleton_warrior", "pos_x": 40, "pos_y": 40, "count": 8, "wander_radius": 3.0},
    {"map_id": "dungeon_01", "mob_def_id": "skeleton_warrior", "pos_x": 100, "pos_y": 80, "count": 6, "wander_radius": 4.0},
    {"map_id": "dungeon_01", "mob_def_id": "death_knight", "pos_x": 75, "pos_y": 130, "count": 1, "wander_radius": 2.0},
]


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        # Maps
        for m in MAPS:
            existing = (await db.execute(select(MapDef).where(MapDef.id == m["id"]))).scalar_one_or_none()
            if not existing:
                db.add(MapDef(**m))

        # Mobs
        for m in MOBS:
            existing = (await db.execute(select(MobDef).where(MobDef.id == m["id"]))).scalar_one_or_none()
            if not existing:
                db.add(MobDef(
                    id=m["id"], name=m["name"], level=m["level"], hp=m["hp"],
                    atk=m["atk"], def_=m["def"], exp_reward=m["exp_reward"],
                    gold_reward_min=m["gold_reward_min"], gold_reward_max=m["gold_reward_max"],
                    aggro_radius=m["aggro_radius"], respawn_ms=m["respawn_ms"],
                    loot_table=m["loot_table"],
                ))

        # Skills
        for s in SKILLS:
            existing = (await db.execute(select(SkillDef).where(SkillDef.id == s["id"]))).scalar_one_or_none()
            if not existing:
                db.add(SkillDef(
                    id=s["id"], name=s["name"], char_class=s["char_class"],
                    description=s["description"], max_level=s["max_level"], level_req=s["level_req"],
                    cooldown_ms=s["cooldown_ms"], mp_cost=s["mp_cost"],
                    damage_base=s["damage_base"], damage_scaling=s["damage_scaling"],
                    scaling_stat=s["scaling_stat"], aoe_radius=s["aoe_radius"],
                    range_=s["range"], duration_ms=s["duration_ms"], extra=s["extra"],
                ))

        # Spawns
        for sp in SPAWNS:
            existing = (await db.execute(
                select(MobSpawn).where(
                    MobSpawn.map_id == sp["map_id"],
                    MobSpawn.mob_def_id == sp["mob_def_id"],
                    MobSpawn.pos_x == sp["pos_x"],
                    MobSpawn.pos_y == sp["pos_y"],
                )
            )).scalar_one_or_none()
            if not existing:
                from uuid import uuid4
                db.add(MobSpawn(id=str(uuid4()), **sp))

        await db.commit()
        print("Seed complete!")
        print(f"  Maps: {len(MAPS)}")
        print(f"  Mobs: {len(MOBS)}")
        print(f"  Skills: {len(SKILLS)}")
        print(f"  Spawns: {len(SPAWNS)}")


if __name__ == "__main__":
    asyncio.run(seed())
