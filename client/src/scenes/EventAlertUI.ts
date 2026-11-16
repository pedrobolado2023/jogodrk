import Phaser from "phaser";
import { ensureMenuIcons, MENU_ICON } from "../gfx/menuIcons";
import { txt } from "./uiStyle";

/** One alert on screen: an event about to start (with a countdown) or happening now (with a button to join). */
export interface EventAlert {
  /** icon key from gfx/menuIcons (boss, guilda...) */
  icon: string;
  title: string;
  /** the line under the title; `{t}` is replaced by the countdown (m:ss) */
  text: string;
  /** Date.now() when the countdown reaches zero (optional) */
  endsAt?: number;
  /** what the line says when the countdown is over */
  doneText?: string;
  button?: { label: string; onClick: () => void };
}

const W = 340, H = 70;

/**
 * Small framed boxes at the top of the screen that warn about events ("Boss Global em 4:59"). Any event can use
 * them: show(id, ...) adds or updates one, hide(id) removes it; the player can close one with the ✕.
 */
export class EventAlertUI {
  private boxes = new Map<string, { root: Phaser.GameObjects.Container; line: Phaser.GameObjects.Text; alert: EventAlert }>();
  /** alerts the player closed: they stay away until hide() is called for them */
  private dismissed = new Set<string>();
  private root: Phaser.GameObjects.Container;
  private timer: Phaser.Time.TimerEvent;

  constructor(private scene: Phaser.Scene) {
    ensureMenuIcons(scene);
    this.root = scene.add.container(0, 0).setDepth(40);
    this.timer = scene.time.addEvent({ delay: 250, loop: true, callback: () => this.tick() });
    scene.events.once("shutdown", () => this.timer.remove());
  }

  show(id: string, alert: EventAlert): void {
    if (this.dismissed.has(id)) return;
    const old = this.boxes.get(id);
    if (old && sameLook(old.alert, alert)) { old.alert = alert; this.tick(); return; }
    old?.root.destroy();
    const s = this.scene;
    const g = s.add.graphics();
    // dark plate with a gold frame and a red glow at the left, like the icons at the top
    g.fillStyle(0x000000, 0.45).fillRoundedRect(-W / 2 + 3, 4, W, H, 10);
    g.fillStyle(0x120c10, 0.94).fillRoundedRect(-W / 2, 0, W, H, 10);
    g.fillStyle(0x6a1010, 0.35).fillRoundedRect(-W / 2, 0, 90, H, 10);
    g.lineStyle(3, 0x1a1006, 1).strokeRoundedRect(-W / 2, 0, W, H, 10);
    g.lineStyle(2, 0xd6a548, 1).strokeRoundedRect(-W / 2, 0, W, H, 10);
    g.lineStyle(1, 0xffeaa8, 0.35).strokeRoundedRect(-W / 2 + 4, 4, W - 8, H - 8, 7);
    const glow = s.add.image(-W / 2 + 36, H / 2, "menu_icon_glow").setScale(66 / MENU_ICON);
    s.tweens.add({ targets: glow, alpha: { from: 1, to: 0.25 }, duration: 700, yoyo: true, repeat: -1 });
    const icon = s.add.image(-W / 2 + 36, H / 2, `menu_icon_${alert.icon}`).setScale(56 / MENU_ICON);
    const x0 = -W / 2 + 72;
    const title = s.add.text(x0, 9, alert.title, txt(13, "#ffd77a", { fontStyle: "bold" }));
    const line = s.add.text(x0, 30, "", txt(11, "#f0e2c0", { wordWrap: { width: W - 84 - (alert.button ? 70 : 0) } }));
    const parts: Phaser.GameObjects.GameObject[] = [g, glow, icon, title, line];
    if (alert.button) {
      const bx = W / 2 - 44, by = H / 2 + 6;
      const bg = s.add.graphics();
      bg.fillStyle(0x7a1a10, 1).fillRoundedRect(bx - 34, by - 13, 68, 26, 6);
      bg.lineStyle(2, 0xffc860, 1).strokeRoundedRect(bx - 34, by - 13, 68, 26, 6);
      const bt = s.add.text(bx, by, alert.button.label, txt(11, "#fff2c0", { fontStyle: "bold" })).setOrigin(0.5);
      const hit = s.add.zone(bx, by, 68, 26).setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => this.boxes.get(id)?.alert.button?.onClick());
      hit.on("pointerover", () => bg.setAlpha(0.8)).on("pointerout", () => bg.setAlpha(1));
      parts.push(bg, bt, hit);
    }
    const close = s.add.text(W / 2 - 8, 5, "✕", txt(12, "#bfa77a")).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on("pointerdown", () => { this.dismissed.add(id); this.remove(id); });
    parts.push(close);
    const root = s.add.container(0, 0, parts);
    this.root.add(root);
    this.boxes.set(id, { root, line, alert });
    // slides in from above (restack moves it to its place)
    root.setAlpha(0).setY(-20 + (this.boxes.size - 1) * (H + 8));
    this.tick();
    this.restack();
  }

  hide(id: string): void {
    this.dismissed.delete(id);
    this.remove(id);
  }

  has(id: string): boolean {
    return this.boxes.has(id);
  }

  /** Top centre of the stack (screen coordinates) and its scale. */
  place(x: number, y: number, scale: number): void {
    this.root.setPosition(x, y).setScale(scale);
  }

  private remove(id: string): void {
    const b = this.boxes.get(id);
    if (!b) return;
    this.boxes.delete(id);
    this.scene.tweens.add({ targets: b.root, alpha: 0, duration: 200, onComplete: () => b.root.destroy() });
    this.restack();
  }

  private restack(): void {
    let i = 0;
    for (const { root } of this.boxes.values()) {
      this.scene.tweens.killTweensOf(root);
      this.scene.tweens.add({ targets: root, y: i * (H + 8), alpha: 1, duration: 300, ease: "Back.Out" });
      i++;
    }
  }

  private tick(): void {
    for (const { line, alert } of this.boxes.values()) {
      let text = alert.text;
      if (alert.endsAt !== undefined) {
        const left = Math.max(0, Math.ceil((alert.endsAt - Date.now()) / 1000));
        text = left > 0 || !alert.doneText
          ? text.replace("{t}", `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`)
          : alert.doneText;
      }
      if (line.text !== text) line.setText(text);
    }
  }
}

function sameLook(a: EventAlert, b: EventAlert): boolean {
  return a.icon === b.icon && a.title === b.title && !!a.button === !!b.button && a.button?.label === b.button?.label;
}
