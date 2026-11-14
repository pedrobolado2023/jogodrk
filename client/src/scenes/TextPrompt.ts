/**
 * Small "type a name" dialog (guild name, player to invite, guild to fight…). HTML over the canvas so
 * typing just works; keys never reach the game while it is open.
 */
import { FONT } from "../gfx/draw";

export interface TextRequest {
  title: string;
  hint?: string;
  placeholder?: string;
  confirm: string;
  maxLength?: number;
  onConfirm: (text: string) => void;
}

export class TextPrompt {
  private root: HTMLDivElement;

  constructor(req: TextRequest) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed", inset: "0", display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.45)", zIndex: "20", font: `13px ${FONT}`, color: "#e8dcc0",
    } as Partial<CSSStyleDeclaration>);
    const box = document.createElement("div");
    Object.assign(box.style, {
      width: "300px", padding: "16px 18px", background: "rgba(14,10,18,0.97)", border: "2px solid #6b5226",
      borderRadius: "10px", boxShadow: "0 0 0 1px rgba(214,170,90,0.35) inset", textShadow: "0 1px 2px #000",
    } as Partial<CSSStyleDeclaration>);
    const title = document.createElement("div");
    title.textContent = req.title;
    Object.assign(title.style, { color: "#ffd77a", fontWeight: "bold", fontSize: "15px", textAlign: "center", marginBottom: "10px" });
    box.append(title);
    if (req.hint) {
      const hint = document.createElement("div");
      hint.textContent = req.hint;
      Object.assign(hint.style, { fontSize: "12px", color: "#c8bca0", marginBottom: "10px", lineHeight: "17px" });
      box.append(hint);
    }
    const input = document.createElement("input");
    Object.assign(input, { type: "text", maxLength: req.maxLength ?? 24, placeholder: req.placeholder ?? "", spellcheck: false });
    Object.assign(input.style, {
      width: "100%", boxSizing: "border-box", padding: "6px 8px", font: `13px ${FONT}`, color: "#f3e3b8",
      background: "#1a140c", border: "1px solid #6b5226", borderRadius: "5px", outline: "none",
    });
    box.append(input);

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px" });
    const btn = (label: string, color: string, run: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        font: `bold 13px ${FONT}`, color, background: "#1e1a10", border: "1px solid #6b5226", borderRadius: "5px",
        padding: "6px 14px", cursor: "pointer",
      });
      b.addEventListener("click", run);
      buttons.append(b);
    };
    const confirm = () => {
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      req.onConfirm(text);
      this.close();
    };
    btn("Cancelar", "#bfa77a", () => this.close());
    btn(req.confirm, "#9dff8a", confirm);
    box.append(buttons);

    for (const type of ["keydown", "keyup", "keypress"] as const) this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      else if (e.key === "Escape") this.close();
    });
    this.root.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === this.root) this.close(); });
    this.root.append(box);
    document.body.appendChild(this.root);
    setTimeout(() => input.focus(), 0);
  }

  close(): void {
    this.root.remove();
  }
}
