"""
SQLAlchemy models — PostgreSQL schema for the MMORPG.
"""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import uuid4 as _uuid4


def _str_uuid():
    return str(_uuid4())

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import JSON
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── Enums ────────────────────────────────────────────────────────────────────

class CharacterClass(str, enum.Enum):
    BLADE_MASTER = "blade_master"
    GRAND_SORCERER = "grand_sorcerer"
    NIGHT_RANGER = "night_ranger"


class PKStatus(str, enum.Enum):
    WHITE = "white"   # peaceful
    RED = "red"       # player-killer
    GREY = "grey"     # flagged (attacked but not killed)


class ItemSlot(str, enum.Enum):
    WEAPON = "weapon"
    HELMET = "helmet"
    ARMOR = "armor"
    GLOVES = "gloves"
    BOOTS = "boots"
    RING_L = "ring_l"
    RING_R = "ring_r"
    NECKLACE = "necklace"
    WINGS = "wings"       # cosmetic
    AURA = "aura"         # cosmetic
    PET = "pet"           # cosmetic


class ItemRarity(str, enum.Enum):
    COMMON = "common"
    UNCOMMON = "uncommon"
    RARE = "rare"
    EPIC = "epic"
    LEGENDARY = "legendary"


# ── Users (auth) ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    username = Column(String(32), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_banned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True))

    characters = relationship("Character", back_populates="user", cascade="all, delete-orphan")


# ── Characters ───────────────────────────────────────────────────────────────

class Character(Base):
    __tablename__ = "characters"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(24), unique=True, nullable=False)
    char_class = Column(Enum(CharacterClass), nullable=False)

    # progression
    level = Column(SmallInteger, default=1, nullable=False)
    exp = Column(Integer, default=0, nullable=False)
    stat_points = Column(SmallInteger, default=0, nullable=False)
    skill_points = Column(SmallInteger, default=0, nullable=False)

    # base stats (allocated by player)
    str = Column(SmallInteger, default=5, nullable=False)
    agi = Column(SmallInteger, default=5, nullable=False)
    int_ = Column("int", SmallInteger, default=5, nullable=False)
    vit = Column(SmallInteger, default=5, nullable=False)

    # current state
    hp = Column(Integer, nullable=False, default=100)
    max_hp = Column(Integer, nullable=False, default=100)
    mp = Column(Integer, nullable=False, default=50)
    max_mp = Column(Integer, nullable=False, default=50)

    # world position
    map_id = Column(String(64), nullable=False, default="town_01")
    pos_x = Column(Float, nullable=False, default=0.0)
    pos_y = Column(Float, nullable=False, default=0.0)

    # PK
    pk_status = Column(Enum(PKStatus), default=PKStatus.WHITE, nullable=False)
    pk_kills = Column(Integer, default=0, nullable=False)
    pk_timer_expires = Column(DateTime(timezone=True))

    # currency
    gold = Column(Integer, default=0, nullable=False)
    premium_coins = Column(Integer, default=0, nullable=False)

    # story progress {"q": quest index, "st": offer|active|ready|done, "n": kills} and collected loot counts
    story = Column(JSON, default=dict)
    loot = Column(JSON, default=dict)  # legacy: converted into `bag` on first load (items.migrate_legacy)
    # inventory (see items.py): bag = [{"id", "qty"}], gear = {"weapon"|"armor"|"accessory": item_id}.
    # NULL bag means the character predates the inventory system.
    bag = Column(JSON, nullable=True)
    gear = Column(JSON, nullable=True)
    # open-world PK state (see pk_system.py): {"red_left": seconds of red name left, "kills": innocents killed}
    pk = Column(JSON, nullable=True)
    daily = Column(JSON, nullable=True)
    friends = Column(JSON, nullable=True)
    title = Column(JSON, nullable=True)
    season = Column(JSON, nullable=True)     # season pass progress (season.py)
    cosmetics = Column(JSON, nullable=True)  # titles and auras owned, aura worn
    gems = Column(JSON, nullable=True)       # premium currency (shop.py)
    boosts = Column(JSON, nullable=True)     # shop boosts → end time (unix)

    is_online = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="characters")
    inventory = relationship("InventoryItem", back_populates="character", cascade="all, delete-orphan")
    equipped = relationship("EquippedItem", back_populates="character", cascade="all, delete-orphan")
    skills = relationship("CharacterSkill", back_populates="character", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_characters_map", "map_id", "is_online"),
        Index("ix_characters_user", "user_id"),
    )


# ── Item Definitions (game data) ─────────────────────────────────────────────

class ItemDef(Base):
    """Static item catalog — loaded once, never modified at runtime."""
    __tablename__ = "item_defs"

    id = Column(String(64), primary_key=True)  # e.g. "sword_iron_01"
    name = Column(String(128), nullable=False)
    description = Column(Text, default="")
    rarity = Column(Enum(ItemRarity), nullable=False, default=ItemRarity.COMMON)
    slot = Column(Enum(ItemSlot))  # null = consumable / material
    is_cosmetic = Column(Boolean, default=False, nullable=False)
    level_req = Column(SmallInteger, default=1, nullable=False)
    class_req = Column(Enum(CharacterClass))  # null = any class

    # stat bonuses (zero for cosmetics)
    bonus_str = Column(SmallInteger, default=0, nullable=False)
    bonus_agi = Column(SmallInteger, default=0, nullable=False)
    bonus_int = Column(SmallInteger, default=0, nullable=False)
    bonus_vit = Column(SmallInteger, default=0, nullable=False)
    bonus_atk = Column(SmallInteger, default=0, nullable=False)
    bonus_def = Column(SmallInteger, default=0, nullable=False)
    bonus_crit = Column(Float, default=0.0, nullable=False)  # percent

    # shop
    buy_price = Column(Integer, default=0, nullable=False)
    sell_price = Column(Integer, default=0, nullable=False)
    is_tradeable = Column(Boolean, default=True, nullable=False)
    stack_max = Column(SmallInteger, default=1, nullable=False)

    extra = Column(JSON, default=dict)  # glow color, aura id, pet model, etc.


# ── Inventory (per-character item instances) ──────────────────────────────────

class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    character_id = Column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    item_def_id = Column(String(64), ForeignKey("item_defs.id"), nullable=False)
    quantity = Column(SmallInteger, default=1, nullable=False)
    slot_index = Column(SmallInteger, nullable=False)  # bag position 0-59

    # per-instance mods (enchantments, upgrades)
    enhancement_level = Column(SmallInteger, default=0, nullable=False)
    extra = Column(JSON, default=dict)

    character = relationship("Character", back_populates="inventory")
    item_def = relationship("ItemDef")

    __table_args__ = (
        UniqueConstraint("character_id", "slot_index", name="uq_inv_slot"),
        Index("ix_inv_char", "character_id"),
    )


# ── Equipment (what's currently worn) ────────────────────────────────────────

class EquippedItem(Base):
    __tablename__ = "equipped_items"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    character_id = Column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    slot = Column(Enum(ItemSlot), nullable=False)
    inventory_item_id = Column(String(36), ForeignKey("inventory_items.id", ondelete="SET NULL"))

    character = relationship("Character", back_populates="equipped")
    inventory_item = relationship("InventoryItem")

    __table_args__ = (
        UniqueConstraint("character_id", "slot", name="uq_equip_slot"),
    )


# ── Skill Definitions (game data) ────────────────────────────────────────────

class SkillDef(Base):
    __tablename__ = "skill_defs"

    id = Column(String(64), primary_key=True)  # e.g. "bm_twisting_slash"
    name = Column(String(128), nullable=False)
    char_class = Column(Enum(CharacterClass), nullable=False)
    description = Column(Text, default="")
    max_level = Column(SmallInteger, default=5, nullable=False)
    level_req = Column(SmallInteger, default=1, nullable=False)

    cooldown_ms = Column(Integer, nullable=False)         # base cooldown
    mp_cost = Column(Integer, nullable=False)              # base mp cost
    damage_base = Column(Integer, default=0, nullable=False)
    damage_scaling = Column(Float, default=1.0, nullable=False)  # stat multiplier
    scaling_stat = Column(String(8), default="str")        # str/agi/int
    aoe_radius = Column(Float, default=0.0)                # 0 = single target
    range_ = Column("range", Float, default=1.5)           # tiles
    duration_ms = Column(Integer, default=0)               # buff/debuff duration
    extra = Column(JSON, default=dict)                    # stun_ms, dot_ticks, etc.


# ── Character Skills (unlocked/leveled) ──────────────────────────────────────

class CharacterSkill(Base):
    __tablename__ = "character_skills"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    character_id = Column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    skill_def_id = Column(String(64), ForeignKey("skill_defs.id"), nullable=False)
    level = Column(SmallInteger, default=1, nullable=False)
    hotkey_slot = Column(SmallInteger)  # 1-5, null = not assigned

    character = relationship("Character", back_populates="skills")
    skill_def = relationship("SkillDef")

    __table_args__ = (
        UniqueConstraint("character_id", "skill_def_id", name="uq_char_skill"),
        Index("ix_char_skills", "character_id"),
    )


# ── Mob Definitions (game data) ──────────────────────────────────────────────

class MobDef(Base):
    __tablename__ = "mob_defs"

    id = Column(String(64), primary_key=True)  # e.g. "skeleton_warrior"
    name = Column(String(128), nullable=False)
    level = Column(SmallInteger, nullable=False)
    hp = Column(Integer, nullable=False)
    atk = Column(Integer, nullable=False)
    def_ = Column("def", Integer, nullable=False)
    exp_reward = Column(Integer, nullable=False)
    gold_reward_min = Column(Integer, default=0, nullable=False)
    gold_reward_max = Column(Integer, default=0, nullable=False)
    aggro_radius = Column(Float, default=5.0, nullable=False)  # tiles
    respawn_ms = Column(Integer, default=30000, nullable=False)
    loot_table = Column(JSON, default=list)  # [{item_def_id, drop_rate, qty_min, qty_max}]
    extra = Column(JSON, default=dict)


# ── Mob Spawn Points (per map) ───────────────────────────────────────────────

class MobSpawn(Base):
    __tablename__ = "mob_spawns"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    map_id = Column(String(64), nullable=False)
    mob_def_id = Column(String(64), ForeignKey("mob_defs.id"), nullable=False)
    pos_x = Column(Float, nullable=False)
    pos_y = Column(Float, nullable=False)
    count = Column(SmallInteger, default=1, nullable=False)  # mobs in this cluster
    wander_radius = Column(Float, default=3.0, nullable=False)

    mob_def = relationship("MobDef")

    __table_args__ = (
        Index("ix_mob_spawns_map", "map_id"),
    )


# ── Map Definitions ──────────────────────────────────────────────────────────

class MapDef(Base):
    __tablename__ = "map_defs"

    id = Column(String(64), primary_key=True)  # e.g. "town_01", "forest_01"
    name = Column(String(128), nullable=False)
    is_safe_zone = Column(Boolean, default=False, nullable=False)
    level_min = Column(SmallInteger, default=1, nullable=False)
    level_max = Column(SmallInteger, default=99, nullable=False)
    width = Column(Integer, nullable=False, default=200)   # tiles
    height = Column(Integer, nullable=False, default=200)  # tiles
    connections = Column(JSON, default=list)  # [{map_id, portal_x, portal_y, dest_x, dest_y}]


# ── Cosmetic Shop Catalog ────────────────────────────────────────────────────

class ShopItem(Base):
    __tablename__ = "shop_items"

    id = Column(String(36), primary_key=True, default=_str_uuid)
    item_def_id = Column(String(64), ForeignKey("item_defs.id"), nullable=False)
    premium_price = Column(Integer, nullable=False)  # premium coins
    is_active = Column(Boolean, default=True, nullable=False)
    featured_until = Column(DateTime(timezone=True))

    item_def = relationship("ItemDef")


class GameState(Base):
    """World-wide state saved as JSON documents (e.g. key "market": the player market, see market.py)."""
    __tablename__ = "game_state"

    key = Column(String(64), primary_key=True)
    value = Column(JSON, nullable=False, default=dict)


# ── Real-money purchases (payments.py) and VIP (vip.py) ──────────────────────

class Payment(Base):
    """One purchase: created when the player opens Mercado Pago, approved when Mercado Pago confirms it."""
    __tablename__ = "payments"

    id = Column(String(36), primary_key=True, default=_str_uuid)       # our reference, sent as external_reference
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    character_id = Column(String(36), nullable=False)                   # the hero who receives gems / the pass
    product = Column(String(32), nullable=False)
    amount = Column(Float, nullable=False)                              # in reais
    status = Column(String(20), nullable=False, default="created")      # created | pending | approved | rejected | refunded …
    mp_payment_id = Column(String(32), unique=True, nullable=True)
    delivered = Column(Boolean, nullable=False, default=False)          # gems / pass / VIP already given
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VipStatus(Base):
    """VIP of an account: level and when it ends (unix time), and the day its daily gems were last given."""
    __tablename__ = "vip_status"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    level = Column(SmallInteger, nullable=False, default=0)
    until = Column(Float, nullable=False, default=0.0)
    last_daily = Column(String(10), nullable=True)
