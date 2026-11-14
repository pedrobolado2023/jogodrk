/**
 * Touch devices (phones, tablets) get the touch controls: a joystick, big skill buttons and a menu instead of the
 * keyboard shortcuts. "?mobile=1" in the address forces it on a computer (for testing).
 */
const forced = new URLSearchParams(location.search).get("mobile") === "1";

export const isTouch = (): boolean =>
  forced || (navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches);

/** Full screen and lying down: browsers only allow it right after a tap (iPhone does not allow it at all). */
export function goFullscreenLandscape(): void {
  if (!isTouch() || navigator.maxTouchPoints === 0 || document.fullscreenElement || window.matchMedia("(display-mode: fullscreen)").matches) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const req = el.requestFullscreen?.bind(el);
  if (!req) return;
  req({ navigationUI: "hide" })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => { /* not allowed here: the "gire o celular" notice covers it */ });
}
