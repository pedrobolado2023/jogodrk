/**
 * Rest mode ("modo descanso"): when the tab is hidden or minimized, or the window stays out of focus for a few
 * seconds, the game stops drawing and runs only its logic five times per second, so the auto-farm, the
 * auto-mission, walking and the connection go on while almost nothing is spent.
 *
 * Browsers freeze requestAnimationFrame in hidden tabs and slow normal timers down to once per second (or once
 * per minute after a while), so the beat comes from a tiny Worker, whose timers are not throttled like that.
 * Scenes hear "rest" / "wake" on game.events to drop heavy pictures and skip visual-only work.
 */
import Phaser from "phaser";

const TICK_MS = 200;
const BLUR_DELAY_MS = 4000;

let resting = false;
export const isResting = (): boolean => resting;

export function installRestMode(game: Phaser.Game): void {
  let blurTimer = 0;
  let last = 0;
  const overlay = makeOverlay();

  const tick = () => {
    if (!resting) return;
    const now = performance.now();
    const dt = Math.min(now - last, 1000);
    last = now;
    try {
      game.headlessStep(now, dt);
    } catch (e) {
      console.error(e);
    }
  };
  const beat = makeBeat(tick);

  const enter = () => {
    if (resting) return;
    resting = true;
    game.loop.sleep();
    last = performance.now();
    game.canvas.style.visibility = "hidden";
    overlay.style.display = "flex";
    game.sound?.pauseAll();
    game.events.emit("rest");
    beat.start();
  };
  const exit = () => {
    clearTimeout(blurTimer);
    if (!resting) return;
    resting = false;
    beat.stop();
    overlay.style.display = "none";
    game.canvas.style.visibility = "";
    game.sound?.resumeAll();
    game.events.emit("wake");
    game.loop.resetDelta();
    game.loop.wake();
  };

  document.addEventListener("visibilitychange", () => (document.hidden ? enter() : document.hasFocus() && exit()));
  window.addEventListener("blur", () => {
    clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => { if (!document.hasFocus()) enter(); }, BLUR_DELAY_MS);
  });
  window.addEventListener("focus", exit);
  overlay.addEventListener("pointerdown", exit);
  if (document.hidden) enter();
}

/** A steady beat that keeps going in background tabs (Worker timer), or a plain interval if Workers are blocked. */
function makeBeat(fn: () => void): { start(): void; stop(): void } {
  try {
    const src = "let id=0;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}";
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = fn;
    return { start: () => worker.postMessage(TICK_MS), stop: () => worker.postMessage(0) };
  } catch {
    let id = 0;
    return { start: () => { clearInterval(id); id = window.setInterval(fn, TICK_MS); }, stop: () => clearInterval(id) };
  }
}

function makeOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed", inset: "0", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: "10px", background: "#07060a", color: "#e8dcc0", fontFamily: "Cinzel, Georgia, serif", textAlign: "center",
    zIndex: "50", cursor: "pointer", userSelect: "none", padding: "16px",
  } as CSSStyleDeclaration);
  el.innerHTML = '<div style="font-size:26px;color:#ffd77a;font-weight:bold;letter-spacing:2px">MODO DESCANSO</div>'
    + '<div style="font-size:14px;color:#c8bca0;max-width:420px;line-height:1.5">Seu herói continua no jogo: '
    + "o modo automático e a missão seguem rodando, gastando quase nada do computador.</div>"
    + '<div style="font-size:13px;color:#a8987a;margin-top:6px">Clique ou volte à janela para continuar</div>';
  document.body.appendChild(el);
  return el;
}
