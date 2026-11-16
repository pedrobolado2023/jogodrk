/**
 * Admin panel (/privado): a plain page (no Phaser) on top of the server's /admin API. Only accounts listed in the
 * server's ADMIN_USERS get past the first request; everyone else sees "this account is not an administrator".
 */
import { API } from "../data/meta";
import { getToken, setToken } from "../network/session";

interface Player {
  id: string; name: string; class: string; level: number; gold: number; gems: number; map: string;
  online: boolean; user_id: string; username: string; banned: boolean; created_at: string | null;
}
interface Overview {
  online: number; accounts: number; characters: number; banned: number; uptime: number;
  maps: [string, number][]; boss: { state: string; name: string | null }; log: { at: string; admin: string; action: string; target: string }[];
}

const CLASS_NAMES: Record<string, string> = { blade_master: "Mestre da Lâmina", grand_sorcerer: "Grande Feiticeiro", night_ranger: "Patrulheiro Noturno" };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString("pt-BR");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let players: Player[] = [];
let selected: Player | null = null;
let itemsLoaded = false;

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new Error("Não foi possível falar com o servidor."); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(typeof data.detail === "string" ? data.detail : "Algo deu errado.") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

let toastTimer = 0;
function toast(text: string, error = false): void {
  const t = $("toast");
  t.textContent = text;
  t.className = `show${error ? " err" : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.className = ""; }, 3200);
}

function showLogin(message = ""): void {
  $("app").classList.add("hidden");
  $("logout").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("who").textContent = "";
  $("login-msg").textContent = message;
}

// ── overview ───────────────────────────────────────────────────────────

function uptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
}

async function loadOverview(): Promise<void> {
  const o = await api<Overview>("/admin/overview");
  $("s-online").textContent = fmt(o.online);
  $("s-accounts").textContent = fmt(o.accounts);
  $("s-chars").textContent = fmt(o.characters);
  $("s-banned").textContent = fmt(o.banned);
  $("s-uptime").textContent = uptime(o.uptime);
  $("boss-state").textContent = o.boss.state === "idle" ? "Nenhum Boss Global ativo agora. Comece um:"
    : `${o.boss.name ?? "Boss"} — ${o.boss.state === "active" ? "em batalha" : "terminando"}.`;
  document.querySelectorAll<HTMLButtonElement>("#bosses button").forEach((b) => { b.disabled = o.boss.state !== "idle"; });
  $("maps").innerHTML = o.maps.length ? o.maps.map(([name, n]) => `<div><span>${esc(name)}</span><b>${n}</b></div>`).join("")
    : `<p class="muted">Ninguém online.</p>`;
  $("log").innerHTML = o.log.length ? o.log.map((e) => {
    const when = new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const who = players.find((p) => p.id === e.target)?.name ?? e.target;
    return `<div><time>${when}</time><b>${esc(e.admin)}</b> · ${esc(e.action)}${who ? ` · <span class="muted">${esc(who)}</span>` : ""}</div>`;
  }).join("") : `<p class="muted">Nenhuma ação ainda.</p>`;
}

// ── the Hidden Wanderer ────────────────────────────────────────────────

interface HiddenView {
  npc: { map: string; map_name: string; x: number; y: number } | null;
  holder: { name: string; desc: string; n: number; count: number; left: number } | null;
  winners: number; next_rumor_in: number | null;
}

function showHidden(v: HiddenView): void {
  const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}min`;
  const rows: [string, string][] = v.holder
    ? [["Situação", `Com ${v.holder.name} (escondido para os outros)`], ["Missão", v.holder.desc],
       ["Progresso", `${v.holder.n}/${v.holder.count}`], ["Tempo restante", hm(v.holder.left)]]
    : [["Situação", "Escondido, esperando alguém achar"],
       ["Onde", v.npc ? `${v.npc.map_name} (x ${Math.round(v.npc.x)}, y ${Math.round(v.npc.y)})` : "–"],
       ["Próximo boato", v.next_rumor_in != null ? `em ${hm(v.next_rumor_in)}` : "–"]];
  rows.push(["Vencedores até hoje", String(v.winners)]);
  $("hq-info").innerHTML = rows.map(([k, val]) => `<span>${k}</span><span>${esc(val)}</span>`).join("");
  ($("hq-move") as HTMLButtonElement).disabled = !!v.holder;
  ($("hq-cancel") as HTMLButtonElement).disabled = !v.holder;
}

async function loadHidden(): Promise<void> {
  showHidden(await api<HiddenView>("/admin/hidden"));
}

// ── game settings ──────────────────────────────────────────────────────

interface PotionSetting { id: string; name: string; kind: "hp" | "mp"; percent: number; default: number }
interface Settings {
  pvp_percent: number; pvp_default: number; pvp_min: number; pvp_max: number;
  potions: PotionSetting[]; potion_min: number; potion_max: number;
}

function showSettings(s: Settings): void {
  const input = $("pvp-pct") as HTMLInputElement;
  input.min = String(s.pvp_min);
  input.max = String(s.pvp_max);
  if (document.activeElement !== input) input.value = String(s.pvp_percent);
  $("pvp-now").textContent = `Agora: ${s.pvp_percent}% · padrão do jogo: ${s.pvp_default}% · de ${s.pvp_min}% a ${s.pvp_max}%`;
  // one row per potion (life first); rebuilt only when nobody is typing in it
  const box = $("potions");
  if (box.contains(document.activeElement)) return;
  const rows = [...s.potions].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "hp" ? -1 : 1));
  box.innerHTML = rows.map((p) => `<div class="row">
      <span style="min-width:190px;color:${p.kind === "hp" ? "#ff9a8a" : "#8fc8ff"}">${esc(p.name)}</span>
      <input data-pot="${esc(p.id)}" type="number" min="${s.potion_min}" max="${s.potion_max}" step="1" value="${p.percent}" style="width:90px"> <span>%</span>
      <button class="btn small" data-pot-save="${esc(p.id)}">Salvar</button>
      <span class="muted" style="font-size:12px">agora: ${p.percent}% · padrão: ${p.default}%</span>
    </div>`).join("");
}

$("potions").addEventListener("click", async (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-pot-save]");
  if (!b) return;
  const item = b.dataset.potSave!;
  const input = document.querySelector<HTMLInputElement>(`[data-pot="${CSS.escape(item)}"]`);
  const percent = Math.round(Number(input?.value));
  if (!Number.isFinite(percent) || percent <= 0) { toast("Digite um número.", true); return; }
  const name = b.closest(".row")?.querySelector("span")?.textContent ?? item;
  if (!confirm(`${name}: recuperar ${percent}%?`)) return;
  try {
    const r = await api<Settings & { message: string }>("/admin/settings/potion", { item, percent });
    (document.activeElement as HTMLElement | null)?.blur();
    toast(r.message); showSettings(r); await loadOverview();
  } catch (e) { toast(e instanceof Error ? e.message : "Algo deu errado.", true); }
});

async function loadSettings(): Promise<void> {
  showSettings(await api<Settings>("/admin/settings"));
}

$("pvp-save").addEventListener("click", async () => {
  const percent = Math.round(Number(($("pvp-pct") as HTMLInputElement).value));
  if (!Number.isFinite(percent) || percent <= 0) { toast("Digite um número.", true); return; }
  if (!confirm(`Mudar o dano no PvP para ${percent}% do dano normal?`)) return;
  try { const r = await api<Settings & { message: string }>("/admin/settings/pvp", { percent }); toast(r.message); showSettings(r); await loadOverview(); }
  catch (e) { toast(e instanceof Error ? e.message : "Algo deu errado.", true); }
});

// ── players ────────────────────────────────────────────────────────────

async function loadPlayers(): Promise<void> {
  const q = encodeURIComponent(($("q") as HTMLInputElement).value.trim());
  const online = ($("only-online") as HTMLInputElement).checked;
  const data = await api<{ players: Player[] }>(`/admin/players?q=${q}${online ? "&online=true" : ""}`);
  players = data.players;
  $("players-empty").classList.toggle("hidden", players.length > 0);
  $("players").innerHTML = players.map((p) => `
    <tr data-id="${p.id}" class="${selected?.id === p.id ? "sel" : ""}">
      <td><b>${esc(p.name)}</b></td>
      <td class="cls-${p.class}">${CLASS_NAMES[p.class] ?? p.class}</td>
      <td class="num">${p.level}</td>
      <td>${esc(p.map)}</td>
      <td class="num">${fmt(p.gold)}</td>
      <td class="num">${fmt(p.gems)}</td>
      <td class="muted">${esc(p.username)}</td>
      <td>${p.banned ? `<span class="pill ban">Bloqueada</span>` : p.online ? `<span class="pill on">Online</span>` : `<span class="pill off">Offline</span>`}</td>
    </tr>`).join("");
  if (selected) {
    const again = players.find((p) => p.id === selected!.id);
    if (again) openDetail(again);
  }
}

function openDetail(p: Player): void {
  selected = p;
  $("d-name").textContent = p.name;
  $("d-facts").innerHTML = [
    ["Classe", CLASS_NAMES[p.class] ?? p.class], ["Nível", String(p.level)], ["Mapa", p.map],
    ["Ouro", fmt(p.gold)], ["Gemas", fmt(p.gems)], ["Conta", p.username],
    ["Situação", p.banned ? "Conta bloqueada" : p.online ? "Online" : "Offline"],
    ["Criado em", p.created_at ? new Date(p.created_at).toLocaleDateString("pt-BR") : "–"],
  ].map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join("");
  const ban = $("d-ban");
  ban.textContent = p.banned ? "Desbloquear conta" : "Bloquear conta";
  ban.className = `btn small ${p.banned ? "green" : "red"}`;
  document.querySelectorAll<HTMLButtonElement>('#detail [data-act="message"], #detail [data-act="kick"]').forEach((b) => { b.disabled = !p.online; });
  document.querySelectorAll("#players tr").forEach((tr) => tr.classList.toggle("sel", (tr as HTMLElement).dataset.id === p.id));
  $("detail").classList.add("open");
  if (!itemsLoaded) void loadItems();
}

async function loadItems(): Promise<void> {
  const { items } = await api<{ items: { id: string; name: string; type: string }[] }>("/admin/items");
  const groups: Record<string, string> = { gear: "Equipamentos", consumable: "Consumíveis", material: "Materiais" };
  const byType = new Map<string, typeof items>();
  for (const it of items) byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  $("d-item").innerHTML = [...byType].map(([type, list]) =>
    `<optgroup label="${esc(groups[type] ?? type)}">${list.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</optgroup>`).join("");
  itemsLoaded = true;
}

async function act(kind: string): Promise<void> {
  const p = selected;
  if (!p) return;
  const num = (id: string) => Math.trunc(Number(($(id) as HTMLInputElement).value) || 0);
  let path = "", body: unknown = {};
  switch (kind) {
    case "gold+": case "gold-": path = `/admin/character/${p.id}/gold`; body = { amount: num("d-gold") * (kind === "gold-" ? -1 : 1) }; break;
    case "gems+": case "gems-": path = `/admin/character/${p.id}/gems`; body = { amount: num("d-gems") * (kind === "gems-" ? -1 : 1) }; break;
    case "item": path = `/admin/character/${p.id}/item`; body = { item: ($("d-item") as HTMLSelectElement).value, qty: Math.max(1, num("d-qty")) }; break;
    case "message": path = `/admin/character/${p.id}/message`; body = { text: ($("d-msg") as HTMLInputElement).value }; break;
    case "town": path = `/admin/character/${p.id}/town`; break;
    case "kick":
      if (!confirm(`Desconectar ${p.name}?`)) return;
      path = `/admin/character/${p.id}/kick`; break;
    case "ban":
      if (!confirm(p.banned ? `Desbloquear a conta ${p.username}?` : `Bloquear a conta ${p.username}? Todos os heróis dela serão desconectados.`)) return;
      path = `/admin/user/${p.user_id}/ban`; body = { banned: !p.banned }; break;
    default: return;
  }
  try {
    const r = await api<{ message: string }>(path, body);
    toast(r.message);
    if (kind === "message") ($("d-msg") as HTMLInputElement).value = "";
    await Promise.all([loadPlayers(), loadOverview()]);
  } catch (e) {
    toast(e instanceof Error ? e.message : "Algo deu errado.", true);
  }
}

// ── start ──────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  if (!getToken()) { showLogin(); return; }
  try {
    const me = await api<{ username: string; bosses: { n: number; name: string; level: number }[] }>("/admin/me");
    $("who").textContent = `Conectado como ${me.username}`;
    $("bosses").innerHTML = me.bosses.map((b) => `<button class="btn small" data-boss="${b.n}">${esc(b.name)} · Nv ${b.level}</button>`).join("");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) setToken("");
    showLogin(status === 403 ? "Esta conta não é administradora. Entre com uma conta de administrador." : e instanceof Error ? e.message : "");
    return;
  }
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("logout").classList.remove("hidden");
  await Promise.all([loadPlayers(), loadOverview(), loadHidden(), loadSettings()]).catch((e) => toast(e.message, true));
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("login-msg").textContent = "Entrando…";
  try {
    const data = await api<{ token: string }>("/auth/login", {
      username: ($("lu") as HTMLInputElement).value.trim(), password: ($("lp") as HTMLInputElement).value,
    });
    setToken(data.token);
    ($("lp") as HTMLInputElement).value = "";
    await start();
  } catch (e) {
    $("login-msg").textContent = e instanceof Error ? e.message : "Não foi possível entrar.";
  }
});
$("logout").addEventListener("click", () => { setToken(""); selected = null; $("detail").classList.remove("open"); showLogin(); });
$("players").addEventListener("click", (ev) => {
  const tr = (ev.target as HTMLElement).closest("tr");
  const p = tr && players.find((x) => x.id === tr.dataset.id);
  if (p) openDetail(p);
});
$("d-close").addEventListener("click", () => { selected = null; $("detail").classList.remove("open"); document.querySelectorAll("#players tr.sel").forEach((t) => t.classList.remove("sel")); });
$("detail").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
  if (b) void act(b.dataset.act!);
});
$("bosses").addEventListener("click", async (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-boss]");
  if (!b || !confirm(`Começar agora: ${b.textContent}?`)) return;
  try { toast((await api<{ message: string }>("/admin/boss/start", { boss: Number(b.dataset.boss) })).message); await loadOverview(); }
  catch (e) { toast(e instanceof Error ? e.message : "Algo deu errado.", true); }
});
$("bc-send").addEventListener("click", async () => {
  const text = ($("bc-text") as HTMLTextAreaElement).value.trim();
  if (!text) { toast("Escreva o aviso.", true); return; }
  if (!confirm(`Enviar para todos os jogadores online?\n\n${text}`)) return;
  try { toast((await api<{ message: string }>("/admin/broadcast", { text })).message); ($("bc-text") as HTMLTextAreaElement).value = ""; await loadOverview(); }
  catch (e) { toast(e instanceof Error ? e.message : "Algo deu errado.", true); }
});
for (const [id, path, ask] of [["hq-move", "/admin/hidden/move", "Mudar o Andarilho Oculto para outro lugar?"],
  ["hq-cancel", "/admin/hidden/cancel", "Cancelar a Missão Oculta de quem está com ela? O Andarilho volta a se esconder."]] as const) {
  $(id).addEventListener("click", async () => {
    if (!confirm(ask)) return;
    try { const r = await api<HiddenView & { message: string }>(path, {}); toast(r.message); showHidden(r); await loadOverview(); }
    catch (e) { toast(e instanceof Error ? e.message : "Algo deu errado.", true); }
  });
}
let searchTimer = 0;
$("q").addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void loadPlayers().catch((e) => toast(e.message, true)), 300); });
$("only-online").addEventListener("change", () => void loadPlayers().catch((e) => toast(e.message, true)));
$("refresh").addEventListener("click", () => void Promise.all([loadPlayers(), loadOverview()]).catch((e) => toast(e.message, true)));
// keeps the numbers fresh while the page is open
window.setInterval(() => {
  if (!$("app").classList.contains("hidden") && document.visibilityState === "visible") {
    void loadOverview().catch(() => {});
    void loadHidden().catch(() => {});
  }
}, 10000);

void start();
