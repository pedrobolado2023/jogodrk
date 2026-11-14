/**
 * "List on the market" dialog: quantity (for stacks) and total price, with the listing fee and what the
 * seller receives after the sales tax worked out live. HTML over the canvas so typing numbers just works;
 * keys never reach the game while it is open.
 */
import { FONT } from "../gfx/draw";

export interface PriceRequest {
  name: string;
  color: string;
  maxQty: number;          // 1 for gear
  suggested: number;       // price per unit to start from
  fee: number;             // listing fee rate (0.02)
  tax: number;             // sales tax rate (0.08)
  onConfirm: (qty: number, price: number) => void;
}

export class PricePrompt {
  private root: HTMLDivElement;

  constructor(req: PriceRequest) {
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
    title.textContent = "Anunciar no Mercado";
    Object.assign(title.style, { color: "#ffd77a", fontWeight: "bold", fontSize: "15px", textAlign: "center", marginBottom: "8px" });
    const item = document.createElement("div");
    item.textContent = req.name;
    Object.assign(item.style, { color: req.color, fontWeight: "bold", textAlign: "center", marginBottom: "12px" });

    const field = (label: string, value: number, max?: number): HTMLInputElement => {
      const row = document.createElement("label");
      Object.assign(row.style, { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0" });
      row.append(label);
      const input = document.createElement("input");
      Object.assign(input, { type: "number", min: "1", value: String(value), step: "1" });
      if (max) input.max = String(max);
      Object.assign(input.style, {
        width: "120px", padding: "5px 8px", font: `13px ${FONT}`, color: "#f3e3b8", background: "#1a140c",
        border: "1px solid #6b5226", borderRadius: "5px", outline: "none", textAlign: "right",
      });
      row.append(input);
      box.append(row);
      return input;
    };
    box.append(title, item);
    const qty = req.maxQty > 1 ? field(`Quantidade (até ${req.maxQty})`, req.maxQty, req.maxQty) : null;
    const price = field("Preço total (ouro)", Math.max(1, req.suggested * (qty ? req.maxQty : 1)));
    const info = document.createElement("div");
    Object.assign(info.style, { fontSize: "12px", color: "#c8bca0", margin: "10px 0 12px", lineHeight: "18px" });
    box.append(info);

    const update = () => {
      const p = Math.max(0, Math.floor(Number(price.value) || 0));
      const fee = Math.max(1, Math.ceil(p * req.fee));
      const gets = p - Math.ceil(p * req.tax);
      info.innerHTML = "";
      info.append(`Taxa para anunciar (${Math.round(req.fee * 100)}%): ${fee} ouro`, document.createElement("br"),
        `Se vender, você recebe: ${Math.max(0, gets)} ouro (${Math.round(req.tax * 100)}% de imposto)`, document.createElement("br"),
        "O anúncio dura 48 horas.");
    };
    price.addEventListener("input", update);
    qty?.addEventListener("input", update);
    update();

    const buttons = document.createElement("div");
    Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "10px" });
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
      const q = qty ? Math.max(1, Math.min(req.maxQty, Math.floor(Number(qty.value) || 1))) : 1;
      const p = Math.floor(Number(price.value) || 0);
      if (p < 1) { price.focus(); return; }
      req.onConfirm(q, p);
      this.close();
    };
    btn("Cancelar", "#bfa77a", () => this.close());
    btn("Anunciar", "#9dff8a", confirm);
    box.append(buttons);

    for (const type of ["keydown", "keyup", "keypress"] as const) this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirm();
      else if (e.key === "Escape") this.close();
    });
    this.root.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === this.root) this.close(); });
    this.root.append(box);
    document.body.appendChild(this.root);
    setTimeout(() => { price.focus(); price.select(); }, 0);
  }

  close(): void {
    this.root.remove();
  }
}
