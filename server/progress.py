"""
Long-term progress of a hero, kept in one JSON column (characters.progress):

- the first steps (a short guided tutorial for new heroes, with a welcome gift at the end);
- the login calendar (7 days of gifts, one per day the hero comes back, bigger each day);
- achievements (counters for monsters, bosses, PvP, places found... each with a reward);
- this week's counters (PvP kills and monsters), used by the weekly ranking.

Pure logic: the Game gives the rewards and sends the messages. Player-facing text is in Portuguese.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

BR = dt.timezone(dt.timedelta(hours=-3))  # Brasília time: the day and the week turn at midnight there

# ── first steps ──────────────────────────────────────────────────────────

TUTORIAL: list[dict[str, Any]] = [
    {"id": "move", "kind": "move", "count": 8, "title": "Andar",
     "text": "Clique no chão para andar. No celular, use o joystick no canto da tela.",
     "reward": [{"gold": 200}]},
    {"id": "talk", "kind": "talk", "target": "elder", "count": 1, "title": "O Ancião",
     "text": "Fale com o Ancião Aldric: é o velho com o ! em cima, no meio da vila. Clique nele.",
     "reward": [{"item": "pot_hp_s", "qty": 5}]},
    {"id": "kill", "kind": "kill", "count": 3, "title": "Primeira caçada",
     "text": "Saia pelo portal do leste até a Floresta Sombria e derrote 3 monstros. A tecla Espaço ataca.",
     "reward": [{"gold": 500}]},
    {"id": "skill", "kind": "skill", "count": 1, "title": "Habilidades",
     "text": "Use uma habilidade num monstro: aperte 1. No celular, toque no botão da habilidade.",
     "reward": [{"item": "pot_mp_s", "qty": 5}]},
    {"id": "level", "kind": "level", "count": 5, "title": "Ficando forte",
     "text": "Chegue ao nível 5. Dica: no painel História, toque em ▶ automático e o herói faz as missões sozinho.",
     "reward": [{"gold": 1000}]},
]
WELCOME_GIFT: list[dict[str, Any]] = [
    {"item": "pot_hp_l", "qty": 10}, {"item": "pot_mp_l", "qty": 10}, {"gold": 3000}, {"boost": "exp", "minutes": 30},
]
VETERAN_LEVEL = 5  # heroes already past this (or past the first quest) skip the tutorial


def tutorial(p: dict[str, Any], level: int = 1, story_q: int = 0) -> dict[str, Any]:
    t = p.setdefault("tut", {"step": 0, "n": 0, "done": False})
    if not t.get("done") and t.get("step", 0) == 0 and t.get("n", 0) == 0 and (level >= VETERAN_LEVEL or story_q >= 1):
        t.update(done=True, skipped=True)
    return t


def tutorial_public(p: dict[str, Any]) -> dict[str, Any]:
    t = p.get("tut") or {}
    if t.get("done"):
        return {"done": True}
    i = t.get("step", 0)
    s = TUTORIAL[i]
    return {"done": False, "step": i + 1, "steps": len(TUTORIAL), "title": s["title"], "text": s["text"],
            "n": min(t.get("n", 0), s["count"]), "count": s["count"], "reward": s["reward"]}


def tutorial_track(p: dict[str, Any], kind: str, target: str, amount: float, level: int) -> list[dict[str, Any]]:
    """Advances the first steps; returns the steps finished now (each has its reward)."""
    t = p.get("tut")
    if not t or t.get("done"):
        return []
    done: list[dict[str, Any]] = []
    while not t["done"]:
        s = TUTORIAL[t["step"]]
        if s["kind"] == "level":
            t["n"] = max(t.get("n", 0), level)
        elif s["kind"] == kind and (not s.get("target") or s["target"] == target):
            t["n"] = t.get("n", 0) + amount
            kind = ""  # one event counts for one step only
        if t["n"] < s["count"]:
            break
        done.append(s)
        t["step"] += 1
        t["n"] = 0
        if t["step"] >= len(TUTORIAL):
            t["done"] = True
    return done


# ── login calendar ───────────────────────────────────────────────────────

LOGIN_DAYS: list[list[dict[str, Any]]] = [
    [{"gold": 1000, "scaled": True}],
    [{"item": "pot_hp_l", "qty": 10}],
    [{"item": "stone_up_1", "qty": 5}],
    [{"boost": "exp", "minutes": 30}],
    [{"gold": 3000, "scaled": True}, {"item": "pot_mp_l", "qty": 10}],
    [{"item": "stone_up_2", "qty": 3}],
    [{"gems": 50}, {"boost": "exp", "minutes": 60}, {"item": "stone_protect", "qty": 1}],
]
LOGIN_TITLE = "fiel"  # the first full week of the calendar


def today() -> str:
    return dt.datetime.now(BR).date().isoformat()


def login(p: dict[str, Any]) -> dict[str, Any]:
    return p.setdefault("login", {"day": 0, "last": "", "total": 0})


def login_ready(p: dict[str, Any]) -> bool:
    return login(p).get("last") != today()


def login_public(p: dict[str, Any], level: int) -> dict[str, Any]:
    lg = login(p)
    return {"day": lg["day"], "ready": login_ready(p), "total": lg.get("total", 0),
            "days": [[scale(r, level) for r in day] for day in LOGIN_DAYS]}


def login_claim(p: dict[str, Any], level: int) -> list[dict[str, Any]] | None:
    """Today's gifts (and the calendar moves on), or None when today's gift was already taken."""
    if not login_ready(p):
        return None
    lg = login(p)
    day = lg["day"] % len(LOGIN_DAYS)
    rewards = [scale(r, level) for r in LOGIN_DAYS[day]]
    if day == len(LOGIN_DAYS) - 1 and not lg.get("week_done"):
        rewards.append({"title": LOGIN_TITLE})
        lg["week_done"] = True
    lg["day"] = (day + 1) % len(LOGIN_DAYS)
    lg["last"] = today()
    lg["total"] = lg.get("total", 0) + 1
    return rewards


def scale(r: dict[str, Any], level: int) -> dict[str, Any]:
    """Gold gifts grow with the hero's level, so they matter at level 5 and at level 500."""
    if r.get("scaled"):
        return {"gold": int(r["gold"] * (1 + level / 10))}
    return dict(r)


# ── achievements ─────────────────────────────────────────────────────────

def A(aid: str, name: str, desc: str, kind: str, count: int, reward: list[dict[str, Any]]) -> dict[str, Any]:
    return {"id": aid, "name": name, "desc": desc, "kind": kind, "count": count, "reward": reward}


ACHIEVEMENTS: list[dict[str, Any]] = [
    A("kill_100", "Caçador Iniciante", "Derrote 100 monstros.", "kill", 100, [{"gold": 2000}]),
    A("kill_1000", "Caçador", "Derrote 1.000 monstros.", "kill", 1000, [{"gold": 15000}, {"item": "stone_up_1", "qty": 10}]),
    A("kill_10000", "Exterminador", "Derrote 10.000 monstros.", "kill", 10000, [{"gems": 50}, {"item": "stone_up_2", "qty": 10}]),
    A("kill_50000", "Flagelo das Feras", "Derrote 50.000 monstros.", "kill", 50000, [{"gems": 150}, {"title": "flagelo"}]),
    A("boss_1", "Primeiro Chefe", "Derrote um chefe.", "boss", 1, [{"gold": 3000}]),
    A("boss_25", "Caçador de Chefes", "Derrote 25 chefes.", "boss", 25, [{"gems": 30}, {"item": "stone_up_2", "qty": 5}]),
    A("boss_100", "Matador de Reis", "Derrote 100 chefes.", "boss", 100, [{"gems": 100}, {"title": "matador_reis"}]),
    A("pvp_1", "Primeiro Sangue", "Derrote um jogador.", "pvp_kill", 1, [{"gold": 2000}]),
    A("pvp_50", "Duelista", "Derrote 50 jogadores.", "pvp_kill", 50, [{"gems": 40}]),
    A("pvp_500", "Terror da Arena", "Derrote 500 jogadores.", "pvp_kill", 500, [{"gems": 150}, {"title": "terror_arena"}]),
    A("duel_10", "Cavalheiro", "Vença 10 duelos.", "duel_win", 10, [{"gems": 30}]),
    A("duel_100", "Mestre dos Duelos", "Vença 100 duelos.", "duel_win", 100, [{"gems": 100}, {"title": "mestre_duelos"}]),
    A("tourney_1", "Pódio", "Termine um torneio no pódio (top 3).", "tourney", 1, [{"gems": 50}]),
    A("disc_10", "Curioso", "Ache 10 lugares escondidos.", "discover", 10, [{"gold": 10000}]),
    A("disc_25", "Explorador", "Ache 25 lugares escondidos.", "discover", 25, [{"gems": 40}]),
    A("level_50", "Aventureiro", "Chegue ao nível 50.", "level", 50, [{"gold": 20000}]),
    A("level_100", "Herói", "Chegue ao nível 100.", "level", 100, [{"gems": 50}]),
    A("level_300", "Lenda", "Chegue ao nível 300.", "level", 300, [{"gems": 150}]),
    A("mine_100", "Mineiro", "Junte 100 minérios.", "mine", 100, [{"gold": 5000}]),
    A("mine_1000", "Barão do Ferro", "Junte 1.000 minérios.", "mine", 1000, [{"gems": 40}]),
    A("forge_25", "Aprendiz de Ferreiro", "Tente aprimorar 25 vezes na forja.", "forge", 25, [{"item": "stone_protect", "qty": 1}]),
    A("daily_7", "Dedicado", "Entregue as diárias 7 vezes.", "daily", 7, [{"gems": 20}]),
    A("daily_30", "Incansável", "Entregue as diárias 30 vezes.", "daily", 30, [{"gems": 60}]),
    A("wb_1", "Contra o Colosso", "Participe de um Boss Global.", "wb", 1, [{"gold": 5000}]),
    A("wb_20", "Caçador de Titãs", "Participe de 20 Boss Globais.", "wb", 20, [{"gems": 60}]),
    A("inv_1", "Defensor", "Ajude a defender a vila de uma invasão.", "invasion", 1, [{"gold": 5000}]),
    A("inv_10", "Muralha de Ravencrest", "Defenda a vila de 10 invasões.", "invasion", 10, [{"gems": 50}, {"title": "muralha"}]),
    A("login_7", "Freguês", "Entre no jogo em 7 dias diferentes.", "login", 7, [{"gems": 20}]),
    A("login_30", "Morador", "Entre no jogo em 30 dias diferentes.", "login", 30, [{"gems": 80}]),
]
ACH_BY_ID = {a["id"]: a for a in ACHIEVEMENTS}
# counters that hold the best value reached (not a sum)
MAX_KINDS = {"level", "discover", "login"}
# titles given by achievements, the calendar and the tournament: id → (name, colour)
TITLES: dict[str, tuple[str, str]] = {
    "flagelo": ("Flagelo das Feras", "#ff9a4a"), "matador_reis": ("Matador de Reis", "#ffc857"),
    "terror_arena": ("Terror da Arena", "#ff5a5a"), "mestre_duelos": ("Mestre dos Duelos", "#6fdcff"),
    "muralha": ("Muralha de Ravencrest", "#9dff8a"), "fiel": ("Fiel de Ravencrest", "#ffd77a"),
    "campeao_torneio": ("Campeão do Torneio", "#ffe14a"), "campeao_semana": ("Campeão da Semana", "#ff8ae0"),
}


def ach(p: dict[str, Any]) -> dict[str, Any]:
    a = p.setdefault("ach", {})
    a.setdefault("c", {})
    a.setdefault("got", [])
    return a


def ach_track(p: dict[str, Any], kind: str, amount: float, value: float | None = None) -> list[dict[str, Any]]:
    """Counts an event; returns the achievements completed now."""
    if not any(x["kind"] == kind for x in ACHIEVEMENTS):
        return []
    a = ach(p)
    c = a["c"]
    if kind in MAX_KINDS:
        c[kind] = max(c.get(kind, 0), value if value is not None else amount)
    else:
        c[kind] = c.get(kind, 0) + amount
    new = []
    for x in ACHIEVEMENTS:
        if x["kind"] == kind and x["id"] not in a["got"] and c[kind] >= x["count"]:
            a["got"].append(x["id"])
            new.append(x)
    return new


def ach_public(p: dict[str, Any]) -> dict[str, Any]:
    a = ach(p)
    return {"got": a["got"], "c": a["c"]}


# ── this week (for the weekly ranking) ───────────────────────────────────

def week_id(when: dt.datetime | None = None) -> str:
    y, w, _ = (when or dt.datetime.now(BR)).isocalendar()
    return f"{y}-W{w:02d}"


def week(p: dict[str, Any]) -> dict[str, Any]:
    wk = p.get("week")
    if not wk or wk.get("id") != week_id():
        wk = p["week"] = {"id": week_id(), "pvp": 0, "kills": 0}
    return wk


def week_track(p: dict[str, Any], kind: str, amount: float) -> None:
    if kind == "pvp_kill":
        week(p)["pvp"] += amount
    elif kind == "kill":
        week(p)["kills"] += amount


def seconds_to_week_end() -> int:
    now = dt.datetime.now(BR)
    start = (now - dt.timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((start + dt.timedelta(days=7) - now).total_seconds())


def clean(p: Any) -> dict[str, Any]:
    return dict(p) if isinstance(p, dict) else {}
