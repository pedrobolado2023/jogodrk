/**
 * WebSocket client — connects to the game server and dispatches events.
 */
import { getToken } from "./session";
import { API, WS_HOST } from "../data/meta";

export type ServerMessage = {
  type: string;
  [key: string]: unknown;
};

type MessageHandler = (msg: ServerMessage) => void;

/** Close code the server uses when a newer connection of the same hero replaces this one (main.py). */
const REPLACED_CODE = 4001;
const KICKED_CODE = 4002; // an administrator disconnected this hero (or blocked the account)

export class GameSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, MessageHandler[]>();
  private reconnectTimer: number | null = null;
  private _characterId = "";
  private _url = "";

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(characterId: string, host = WS_HOST): void {
    // cancel any existing reconnect loop
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._characterId = characterId;
    this._url = `${new URL(API).protocol === "https:" ? "wss" : "ws"}://${host}/ws/${characterId}?token=${encodeURIComponent(getToken())}`;
    this._doConnect();
  }

  private _doConnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = new WebSocket(this._url);

    this.ws.onopen = () => {
      console.log("[WS] connected");
      this.emit("_connected", { type: "_connected" });
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data);
        this.emit(msg.type, msg);
      } catch {
        /* ignore malformed */
      }
    };

    this.ws.onclose = (ev) => {
      if (ev.code === 1008) {
        this.emit("notice", { type: "notice", text: "Sessão inválida. Recarregue a página e entre novamente.", kind: "warn" });
        return;
      }
      if (ev.code === REPLACED_CODE) {
        // the same hero connected from another window/tab: reconnecting would just kick that one back
        console.log("[WS] replaced by a newer connection");
        this.emit("notice", { type: "notice", text: "Seu herói entrou em outra janela. Recarregue a página para jogar aqui.", kind: "warn" });
        return;
      }
      if (ev.code === KICKED_CODE) {
        this.emit("notice", { type: "notice", text: "Você foi desconectado por um administrador. Recarregue a página para voltar.", kind: "warn" });
        return;
      }
      console.log("[WS] disconnected, reconnecting in 3s…");
      this.reconnectTimer = window.setTimeout(() => this._doConnect(), 3000);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler: MessageHandler): void {
    const list = this.handlers.get(type);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private emit(type: string, msg: ServerMessage): void {
    const list = this.handlers.get(type);
    if (list) list.forEach((h) => h(msg));

    // wildcard
    const all = this.handlers.get("*");
    if (all) all.forEach((h) => h(msg));
  }

  // ── convenience senders ────────────────────────────────────────────────

  sendMove(x: number, y: number): void {
    this.send({ type: "move", x, y });
  }

  sendSkill(skillId: string, targetId?: string | null, tx?: number, ty?: number): void {
    this.send({ type: "skill", skill_id: skillId, target_id: targetId ?? null, tx, ty });
  }

  talk(npc: string): void {
    this.send({ type: "talk", npc });
  }

  dialogOption(option: string): void {
    this.send({ type: "dialog_option", option });
  }

  /** Remove every handler (used when the game scene restarts on a map change). */
  clearHandlers(): void {
    this.handlers.clear();
  }

  sendAutoFarm(config: Record<string, unknown>): void {
    this.send({ type: "auto_farm", config });
  }

  sendPing(): void {
    this.send({ type: "ping", ts: Date.now() });
  }
}

export const socket = new GameSocket();
