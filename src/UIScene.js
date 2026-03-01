// ============================================================
// UIScene.js
// HUD overlay Scene.
// - Draws UI in screen-space (no camera jitter, no zoom math).
// - Health bar: bottom-left
// - Round timer: top-center (pixel-art digits)
//
// Timer art filenames expected in your client public assets:
//   assets/images/timer_0.png ... timer_9.png
//   assets/images/timer_colon.png
// Keys are loaded as: "timer_0"..."timer_9", "timer_colon"
//
// Server timer source (Colyseus state):
//   room.state.roundTimeLeftSec  (uint16)
// ============================================================

import Phaser from "phaser";

// ------------------------------
// Health bar style (matches your old bar)
// ------------------------------
const HEALTH_BAR_W_PX = 70;
const HEALTH_BAR_H_PX = 10;

const HEALTH_BAR_BORDER_COLOR = 0x000000;
const HEALTH_BAR_BORDER_ALPHA = 0.9;

const HEALTH_BAR_BG_COLOR = 0x202020;
const HEALTH_BAR_BG_ALPHA = 0.85;

const HEALTH_BAR_FILL_COLOR = 0x00ff00;
const HEALTH_BAR_FILL_ALPHA = 0.95;

// ------------------------------
// HUD placement
// ------------------------------
const HUD_MARGIN_X_PX = 24;
const HUD_MARGIN_Y_PX = 24;

// ------------------------------
// Round timer placement
// ------------------------------
const TIMER_TOP_MARGIN_PX = 18;
const TIMER_GAP_PX = 2; // spacing between digit sprites

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function pad2(n) {
  const v = Math.max(0, Math.min(99, n | 0));
  return v < 10 ? `0${v}` : `${v}`;
}

export default class UIScene extends Phaser.Scene {
  constructor() {
    super("UIScene");

    // Which gameplay scene to read data from (set by GameScene.ensureUIScene()).
    this.gameSceneKey = "GameScene";

    // Health HUD
    this.healthBar = null; // container
    this.healthFill = null; // rect

    // Timer HUD (pixel art)
    this.timerContainer = null; // container
    this.timerSprites = []; // [m1, m2, colon, s1, s2]
    this._lastTimerText = "";

    // Resize handling
    this._onResize = null;
    this._lastW = -1;
    this._lastH = -1;
  }

  init(data) {
    this.gameSceneKey = String(data?.gameSceneKey || "GameScene");
  }

  setGameSceneKey(key) {
    this.gameSceneKey = String(key || "GameScene");
  }

  preload() {
    // Load timer digit sprites (if not already in cache).
    // Put your files in: public/assets/images/
    for (let d = 0; d <= 9; d++) {
      const key = `timer_${d}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/images/${key}.png`);
      }
    }

    if (!this.textures.exists("timer_colon")) {
      this.load.image("timer_colon", "assets/images/timer_colon.png");
    }
  }

  create() {
    // Transparent overlay
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

    // Round pixels to avoid tiny shimmer from sub-pixel placement
    this.cameras.main.setRoundPixels(true);

    this.createHealthBar();
    this.createTimer();

    // Initial layout
    this.ui(true);

    // Re-layout UI when the canvas resizes
    this._onResize = () => this.ui(true);
    this.scale.on("resize", this._onResize);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  cleanup() {
    if (this._onResize && this.scale) {
      this.scale.off("resize", this._onResize);
    }
    this._onResize = null;

    try {
      this.healthBar?.destroy(true);
    } catch (_) {}
    try {
      this.timerContainer?.destroy(true);
    } catch (_) {}

    this.healthBar = null;
    this.healthFill = null;

    this.timerContainer = null;
    this.timerSprites = [];
    this._lastTimerText = "";
  }

  // -----------------------------
  // Health bar creation
  // -----------------------------
  createHealthBar() {
    const plate = this.add
      .rectangle(
        0,
        0,
        HEALTH_BAR_W_PX + 2,
        HEALTH_BAR_H_PX + 2,
        HEALTH_BAR_BORDER_COLOR,
        HEALTH_BAR_BORDER_ALPHA
      )
      .setOrigin(0.5, 0.5);

    const bg = this.add
      .rectangle(0, 0, HEALTH_BAR_W_PX, HEALTH_BAR_H_PX, HEALTH_BAR_BG_COLOR, HEALTH_BAR_BG_ALPHA)
      .setOrigin(0.5, 0.5);

    this.healthFill = this.add
      .rectangle(
        -HEALTH_BAR_W_PX / 2,
        0,
        HEALTH_BAR_W_PX,
        HEALTH_BAR_H_PX,
        HEALTH_BAR_FILL_COLOR,
        HEALTH_BAR_FILL_ALPHA
      )
      .setOrigin(0, 0.5);

    this.healthBar = this.add.container(0, 0, [plate, bg, this.healthFill]);
    this.healthBar.setVisible(false);
  }

  // -----------------------------
  // Timer creation (pixel digits)
  // -----------------------------
  createTimer() {
    // Default display "02:00" so sprites are created with valid textures.
    const makeDigit = (digitChar) => {
      const key = `timer_${digitChar}`;
      const img = this.add.image(0, 0, key);
      img.setOrigin(0, 0.5);
      return img;
    };

    const colon = this.add.image(0, 0, "timer_colon");
    colon.setOrigin(0, 0.5);

    const m1 = makeDigit("0");
    const m2 = makeDigit("2");
    const s1 = makeDigit("0");
    const s2 = makeDigit("0");

    this.timerSprites = [m1, m2, colon, s1, s2];
    this.timerContainer = this.add.container(0, 0, this.timerSprites);
    this.timerContainer.setVisible(true);
  }

  // Update digit textures ONLY when the displayed text changes.
  setTimerText(txt) {
    if (txt === this._lastTimerText) return false;
    this._lastTimerText = txt;

    // format "MM:SS"
    const m1 = txt[0];
    const m2 = txt[1];
    const s1 = txt[3];
    const s2 = txt[4];

    this.timerSprites[0].setTexture(`timer_${m1}`);
    this.timerSprites[1].setTexture(`timer_${m2}`);
    // [2] is colon
    this.timerSprites[3].setTexture(`timer_${s1}`);
    this.timerSprites[4].setTexture(`timer_${s2}`);

    return true;
  }

  // Layout timer centered at the top (based on current digit widths).
  layoutTimer(screenW) {
    if (!this.timerContainer || this.timerSprites.length !== 5) return;

    // total width including gaps
    let totalW = 0;
    for (let i = 0; i < this.timerSprites.length; i++) {
      totalW += this.timerSprites[i].displayWidth;
      if (i !== this.timerSprites.length - 1) totalW += TIMER_GAP_PX;
    }

    const startX = Math.round(screenW / 2 - totalW / 2);

    // place sprites inside the container using absolute screen coords.
    let x = startX;
    for (let i = 0; i < this.timerSprites.length; i++) {
      const spr = this.timerSprites[i];
      spr.x = x;
      spr.y = 0;
      x += spr.displayWidth + TIMER_GAP_PX;
    }

    // Put container at top margin. Sprites are centered vertically (origin 0.5)
    const glyphH = this.timerSprites[0].displayHeight;
    this.timerContainer.x = 0;
    this.timerContainer.y = Math.round(TIMER_TOP_MARGIN_PX + glyphH / 2);
  }

  // ------------------------------------------------------------
  // ui(force)
  // ALL overlay drawing/updates go here.
  // ------------------------------------------------------------
  ui(force = false) {
    const gameScene = this.scene.get(this.gameSceneKey);

    const localPlayer = gameScene?.localPlayer || null;
    const room = gameScene?.room || null;

    const w = Number(this.scale?.width) || 0;
    const h = Number(this.scale?.height) || 0;

    // -------------------------
    // Health bar (local player)
    // -------------------------
    // ✅ Keep the health bar visible even when the player is dead (it will show 0).
    if (!localPlayer) {
      if (this.healthBar) this.healthBar.setVisible(false);
    } else if (this.healthBar && this.healthFill) {
      // Position once when resized
      if (force || w !== this._lastW || h !== this._lastH) {
        const barW = HEALTH_BAR_W_PX + 2;
        const barH = HEALTH_BAR_H_PX + 2;

        this.healthBar.x = Math.round(HUD_MARGIN_X_PX + barW / 2);
        this.healthBar.y = Math.round(h - HUD_MARGIN_Y_PX - barH / 2);

        this._lastW = w;
        this._lastH = h;
      }

      const mh = Math.max(1, Number(localPlayer.maxHealth) || 100);
      const hp = Math.max(0, Math.min(mh, Number(localPlayer.health) || 0));
      const ratio = clamp01(hp / mh);

      this.healthFill.width = HEALTH_BAR_W_PX * ratio;
      this.healthFill.x = -HEALTH_BAR_W_PX / 2;

      this.healthBar.setVisible(true);
    }

    // -------------------------
    // Round timer (server authoritative)
    // -------------------------
    let secLeft = Number(room?.state?.roundTimeLeftSec);
    if (!Number.isFinite(secLeft)) secLeft = 120; // fallback while state connects

    secLeft = Math.max(0, secLeft | 0);

    const minutes = Math.floor(secLeft / 60);
    const seconds = secLeft % 60;

    const txt = `${pad2(minutes)}:${pad2(seconds)}`;
    const changed = this.setTimerText(txt);

    // Layout timer when:
    // - forced (resize)
    // - the text changed (digit art may have different widths)
    // - first run (container y still 0)
    if (force || changed || (this.timerContainer && this.timerContainer.y === 0)) {
      this.layoutTimer(w);
    }

    // When it hits 0:00, do nothing yet (per your request)
  }

  update() {
    this.ui(false);
  }
}