import Phaser from "phaser";
import { LoginScene } from "./scenes/LoginScene";
import { GameScene } from "./scenes/GameScene";
import { HUDScene } from "./scenes/HUDScene";
import { goFullscreenLandscape, isTouch } from "./ui/device";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: "game-container",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0a0a0f",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [LoginScene, GameScene, HUDScene],
  render: {
    pixelArt: false,
    antialias: true,
  },
  // raw frame time: on slow machines animations keep real-time speed instead of slowing down
  fps: { smoothStep: false },
  input: {
    // a finger on the joystick and another on a skill at the same time
    activePointers: 3,
    mouse: {
      preventDefaultWheel: false,
    },
  },
};

// phones: full screen and lying down after the first tap (and again if the player leaves full screen)
if (isTouch()) window.addEventListener("pointerup", goFullscreenLandscape, { passive: true });

// Text is rasterized once, so wait briefly for the webfont; fall back to Georgia if offline.
const fontsReady = Promise.all([document.fonts.load("16px Cinzel"), document.fonts.load("bold 16px Cinzel")]);
const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
Promise.race([fontsReady, timeout]).finally(() => {
  const game = new Phaser.Game(config);
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
});
