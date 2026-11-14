/**
 * Chat box (HTML over the canvas, so accents, IME and copy/paste just work).
 * Enter opens the input, Enter sends, Esc closes. Commands: /g global, /w Name whisper, /r reply, /ajuda.
 * Keys typed in the input never reach the game (stopPropagation), so 1–0, Q, E, I… don't fire while typing.
 */
import { META, PK_INFO, type PkStatus } from "../data/meta";
import { FONT } from "../gfx/draw";
import { isTouch } from "../ui/device";

export interface ChatMsg {
  channel: "map" | "global" | "whisper" | "party" | "guild" | "guild_info" | "event" | "system";
  text: string;
  from?: string;
  from_id?: string;
  to?: string;
  pk?: PkStatus;
  title?: string;
}

const CHANNELS: Record<ChatMsg["channel"], { tag: string; color: string }> = {
  map: { tag: "", color: "#efe6d2" },
  global: { tag: "[Global] ", color: "#ffd77a" },
  whisper: { tag: "", color: "#ff9ad8" },
  party: { tag: "[Grupo] ", color: "#8aff9a" },
  guild: { tag: "[Guilda] ", color: "#8fd0ff" },
  guild_info: { tag: "[Guilda] ", color: "#6fb0e8" },
  event: { tag: "[Evento] ", color: "#ffb347" },
  system: { tag: "", color: "#a8a090" },
};
const MAX_LINES = 80;
const IDLE_MS = 15000;

const HELP = [
  "Enter: falar com quem está no mesmo mapa.",
  "/g mensagem — fala com todos os jogadores online.",
  "/w Nome mensagem — sussurra só para um jogador.",
  "/r mensagem — responde o último sussurro.",
  "/convidar Nome — convida para o seu grupo (ou clique no jogador).",
  "/p mensagem — fala só com o seu grupo.",
  "/sair — sai do grupo.   /expulsar Nome — tira alguém (só o líder).",
  "/amigo Nome — pede amizade.   /amigos (ou F) — abre a lista de amigos.",
  "/gu mensagem — fala com a sua guilda.   /guilda (ou G) — abre a janela da guilda.",
  "/boss — entra no Boss Global quando ele estiver ativo.",
];

export class ChatUI {
  /** opens the friends window (set by the HUD) */
  onFriends?: () => void;
  /** opens the guild window (set by the HUD) */
  onGuild?: () => void;
  private box: HTMLDivElement;
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private open = false;
  private replyTo = "";
  private idleTimer = 0;

  constructor(private send: (msg: Record<string, unknown>) => void) {
    this.box = document.createElement("div");
    Object.assign(this.box.style, {
      position: "fixed", left: "calc(env(safe-area-inset-left) + 10px)", bottom: "10px", width: "340px", zIndex: "9",
      font: `13px ${FONT}`, color: "#efe6d2", textShadow: "0 1px 2px #000, 0 0 3px #000",
      transition: "opacity 0.6s", userSelect: "text",
    } as Partial<CSSStyleDeclaration>);
    this.log = document.createElement("div");
    Object.assign(this.log.style, {
      maxHeight: "112px", overflowY: "auto", padding: "4px 8px", borderRadius: "6px", lineHeight: "17px",
      background: "rgba(10,8,14,0.55)", border: "1px solid rgba(107,82,38,0.6)", scrollbarWidth: "thin",
      overflowWrap: "anywhere", cursor: "text",
    } as Partial<CSSStyleDeclaration>);
    this.input = document.createElement("input");
    Object.assign(this.input, { maxLength: 160, spellcheck: false, placeholder: "Mensagem…  (/g global · /w Nome sussurro · /ajuda)" });
    Object.assign(this.input.style, {
      display: "none", width: "100%", boxSizing: "border-box", marginTop: "4px", padding: "6px 9px",
      font: `13px ${FONT}`, color: "#f3e3b8", background: "rgba(14,10,18,0.94)",
      border: "2px solid #6b5226", borderRadius: "6px", outline: "none",
    } as Partial<CSSStyleDeclaration>);
    this.box.append(this.log, this.input);
    document.body.appendChild(this.box);

    for (const type of ["keydown", "keyup", "keypress"] as const) this.input.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.submit(); this.close(); }
      else if (e.key === "Escape") { e.preventDefault(); this.close(); }
    });
    this.input.addEventListener("blur", () => this.close());
    this.log.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (!this.open) this.openInput(); });
    this.add({ channel: "system", text: isTouch() ? "Toque em Menu → Chat para conversar. Digite /ajuda para ver os comandos." : "Aperte Enter para conversar. Digite /ajuda para ver os comandos." });
  }

  get typing(): boolean {
    return this.open;
  }

  destroy(): void {
    window.clearTimeout(this.idleTimer);
    this.box.remove();
  }

  /** Phones: a smaller log that lets touches through to the joystick under it (the menu opens the input). */
  setTouch(maxHeight: number): void {
    Object.assign(this.log.style, { maxHeight: `${Math.round(maxHeight)}px`, pointerEvents: "none", lineHeight: "14px", fontSize: "10px" });
    // the whole box lets touches through: on iPhone a finger sliding over selectable text cancels the touch, which
    // let go of the joystick; only the typing field (when open) takes touches
    Object.assign(this.box.style, { pointerEvents: "none", userSelect: "none", webkitUserSelect: "none", touchAction: "none" });
    this.input.style.pointerEvents = "auto";
    this.input.style.fontSize = "16px"; // 16px or more: iPhone does not zoom the page when the field is focused
  }

  /** Phones: hidden while a window or the menu covers the screen (the chat is HTML, drawn above the game). */
  setHidden(hidden: boolean): void {
    if (hidden) this.close();
    this.box.style.display = hidden ? "none" : "";
  }

  place(bottom: number, width: number): void {
    this.box.style.bottom = `calc(env(safe-area-inset-bottom) + ${Math.round(bottom)}px)`;
    this.box.style.width = `${Math.round(width)}px`;
  }

  /** Top edge of the chat box, in pixels from the bottom of the screen (for stacking the loot feed above it). */
  height(): number {
    return this.box.offsetHeight;
  }

  openInput(prefix = ""): void {
    this.open = true;
    this.input.style.display = "block";
    this.input.value = prefix;
    this.wake();
    // focus after the key event that opened us has finished, so its Enter doesn't land in the input
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.input.style.display = "none";
    this.input.blur();
    this.wake();
  }

  add(m: ChatMsg): void {
    const ch = CHANNELS[m.channel] ?? CHANNELS.system;
    const line = document.createElement("div");
    line.style.color = ch.color;
    if (m.channel === "whisper") {
      line.append(m.to ? `[Para ${m.to}] ` : `[De ${m.from}] `);
      if (!m.to && m.from) this.replyTo = m.from;
    } else {
      if (ch.tag) line.append(ch.tag);
      const title = m.from && m.title ? META.titles.find((t) => t.id === m.title) : undefined;
      if (title) {
        const tag = document.createElement("span");
        tag.textContent = `[${title.name}] `;
        tag.style.color = title.color;
        line.append(tag);
      }
      if (m.from) {
        const name = document.createElement("span");
        name.textContent = `${m.from}: `;
        name.style.color = m.pk && m.pk !== "white" ? PK_INFO[m.pk].color
          : m.channel === "global" ? "#ffe9a8" : m.channel === "party" ? "#c8ffd0" : "#bcd4ff";
        name.style.fontWeight = "bold";
        line.append(name);
      }
    }
    line.append(m.text); // text node: player text is never parsed as HTML
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.appendChild(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    this.wake();
  }

  /** Full opacity while there is activity; fade down when idle so the chat doesn't cover the world. */
  private wake(): void {
    this.box.style.opacity = "1";
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => { if (!this.open) this.box.style.opacity = "0.45"; }, IDLE_MS);
  }

  private submit(): void {
    const raw = this.input.value.trim();
    if (!raw) return;
    const [cmd, ...rest] = raw.split(/\s+/);
    const body = raw.slice(cmd.length).trim();
    switch (cmd.toLowerCase()) {
      case "/ajuda":
      case "/help":
        for (const h of HELP) this.add({ channel: "system", text: h });
        return;
      case "/g":
      case "/global":
        if (body) this.send({ type: "chat", channel: "global", text: body });
        return;
      case "/w":
      case "/s":
      case "/sussurrar": {
        const to = rest[0] ?? "";
        const text = body.slice(to.length).trim();
        if (!to || !text) { this.add({ channel: "system", text: "Use: /w Nome mensagem" }); return; }
        this.replyTo = to;
        this.send({ type: "chat", channel: "whisper", to, text });
        return;
      }
      case "/p":
      case "/grupo":
        if (body) this.send({ type: "chat", channel: "party", text: body });
        return;
      case "/convidar":
      case "/invite":
        if (!rest[0]) { this.add({ channel: "system", text: "Use: /convidar Nome" }); return; }
        this.send({ type: "party_invite", name: rest[0] });
        return;
      case "/sair":
        this.send({ type: "party_leave" });
        return;
      case "/expulsar":
        if (!rest[0]) { this.add({ channel: "system", text: "Use: /expulsar Nome" }); return; }
        this.send({ type: "party_kick", name: rest[0] });
        return;
      case "/amigo":
      case "/friend":
        if (!rest[0]) { this.add({ channel: "system", text: "Use: /amigo Nome" }); return; }
        this.send({ type: "friend_add", name: rest[0] });
        return;
      case "/amigos":
        this.onFriends?.();
        return;
      case "/gu":
        if (body) this.send({ type: "chat", channel: "guild", text: body });
        return;
      case "/guilda":
        this.onGuild?.();
        return;
      case "/gconvidar":
        if (!rest[0]) { this.add({ channel: "system", text: "Use: /gconvidar Nome" }); return; }
        this.send({ type: "guild_invite", name: rest[0] });
        return;
      case "/boss":
        this.send({ type: "wb_join" });
        return;
      case "/gemasteste": // only on a server started with GAME_DEV_TOOLS=1: "/gemasteste 1000"
        this.send({ type: "gems_dev", amount: Number(rest[0] ?? 1000) });
        return;
      case "/passeteste": // only on a server started with GAME_DEV_TOOLS=1: "/passeteste premium" or "/passeteste xp 5000"
        this.send({ type: "pass_dev", cmd: rest[0] ?? "", amount: Number(rest[1] ?? 0) });
        return;
      case "/bossteste": // only works on a server started with GAME_DEV_TOOLS=1
        this.send({ type: "wb_dev_start", boss: Number(rest[0] ?? 1) });
        return;
      case "/r":
        if (!this.replyTo) { this.add({ channel: "system", text: "Ninguém sussurrou para você ainda." }); return; }
        if (body) this.send({ type: "chat", channel: "whisper", to: this.replyTo, text: body });
        return;
      default:
        if (cmd.startsWith("/")) { this.add({ channel: "system", text: `Comando desconhecido: ${cmd}. Digite /ajuda.` }); return; }
        this.send({ type: "chat", channel: "map", text: raw });
    }
  }
}
