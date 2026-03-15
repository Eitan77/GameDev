// ============================================================
// UIScene.js
// HUD overlay Scene.
// - Draws UI in screen-space (no camera jitter, no zoom math).
// - Health display: bottom-left (IMAGE BAR + 40 MARKERS)
// - Round timer: top-center (pixel-art digits)
// - Leaderboard: bottom-right (medal icons + player names)
//
// Timer art filenames expected in your client public assets:
//   assets/images/timer_0.png ... timer_9.png
//   assets/images/timer_colon.png
// Keys are loaded as: "timer_0"..."timer_9", "timer_colon"
//
// Server timer source (Colyseus state):
//   room.state.roundTimeLeftSec  (uint16)
//
// HEALTH BAR IMAGES expected in your client public assets:
//   assets/images/New Project (10).png   (blank bar background with heart)
//   assets/images/New Project (13).png   (10x80 red marker segment)
// ============================================================

import Phaser from "phaser";
import { SettingsOverlay } from "./settings.js";

// ------------------------------
// Health bar images
// ------------------------------
const HEALTH_BG_KEY = "health_bar_blank";
const HEALTH_SEG_KEY = "health_marker";

// Use encodeURI() so spaces in filenames load correctly in the browser.
const HEALTH_BG_SRC = "assets/images/New Project (10).png";
const HEALTH_SEG_SRC = "assets/images/New Project (13).png";

// 40 markers total
const HEALTH_SEG_COUNT = 40;

// ------------------------------
// HEALTH BAR TWEAK KNOBS
// ------------------------------
// Scales the WHOLE health bar (background + markers).
const HEALTH_UI_SCALE = 0.5;

// Bottom-left corner in screen pixels.
// Increase X to move right. Increase Y to move UP.
const HEALTH_UI_BL_X = 24;
const HEALTH_UI_BL_Y = 24;

// Inner white box in the background image (pixel coords in the source image).
// For New Project (10).png (587x149), the inner white box is exactly 400x80.
// These values were measured from the image itself.
const HEALTH_INNER_X0 = 178;
const HEALTH_INNER_Y0 = 36;
const HEALTH_INNER_W = 400;
const HEALTH_INNER_H = 80;

// ------------------------------
// Round timer placement
// ------------------------------
const TIMER_TOP_MARGIN_PX = 18;
const TIMER_GAP_PX = 2; // spacing between digit sprites

// ------------------------------
// LEADERBOARD TWEAK KNOBS
// ------------------------------
// Master scale — change this one value to resize the whole leaderboard.
const LB_SCALE = 1.2;

// Position: distance from the bottom-right corner of the screen.
// Increase LB_MARGIN_RIGHT_PX to move left. Increase LB_MARGIN_BOTTOM_PX to move up.
const LB_MARGIN_RIGHT_PX = 24;
const LB_MARGIN_BOTTOM_PX = 24;

// Row / column sizing (all scaled by LB_SCALE)
const LB_ROW_H_PX        = Math.round(32  * LB_SCALE); // height of each player row
const LB_MEDAL_COL_W_PX  = Math.round(36  * LB_SCALE); // width of the medal (left) column
const LB_NAME_COL_W_PX   = Math.round(130 * LB_SCALE); // width of the name (right) column
const LB_PADDING_PX       = Math.round(6   * LB_SCALE); // inner padding around the grid
const LB_CORNER_RADIUS    = Math.round(6   * LB_SCALE);

// Background
const LB_BG_COLOR = 0xffffff;
const LB_BG_ALPHA = 0.85;

// Gridlines
const LB_GRID_COLOR = 0x000000;
const LB_GRID_ALPHA = 0.6;
const LB_GRID_LINE_W = 1;

// Name text (font size scaled by LB_SCALE)
const LB_NAME_FONT_SIZE_PX = Math.round(14 * LB_SCALE);
const LB_NAME_FONT_FAMILY  = "Arial, sans-serif";
const LB_NAME_COLOR        = "#000000";

// Medal images (pixel art 16x16, display size scaled by LB_SCALE)
const LB_MEDAL_SCALE = 1.8 * LB_SCALE; // display scale for medal sprites
const LB_MAX_MEDALS  = 4;              // medal_1 .. medal_4

const LB_DEPTH = 100;

// Duration (ms) of the rank-swap slide animation for name texts.
const LB_SWAP_DURATION_MS = 280;

// ------------------------------
// HUD action buttons (top-left)
// ------------------------------
const HUD_BTN_SIZE = 40;
const HUD_BTN_MARGIN = 16;
const HUD_BTN_GAP = 10;
const HUD_BTN_COLOR = 0x1a1f2e;
const HUD_BTN_HOVER = 0x2d3342;
const HUD_BTN_ALPHA = 0.85;
const HUD_BTN_STROKE = 0x3a4260;
const HUD_BTN_FONT = { fontFamily: "Arial, sans-serif", fontSize: "20px", color: "#ffffff" };
const HUD_BTN_DEPTH = 110;

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

    // Health HUD (image-based)
    this.healthBar = null; // container
    this.healthBg = null; // background image
    this.healthMarkers = []; // array of 40 marker images

    // Timer HUD (pixel art)
    this.timerContainer = null; // container
    this.timerSprites = []; // [m1, m2, colon, s1, s2]
    this._lastTimerText = "";

    // Leaderboard HUD
    this.lbContainer = null;    // container holding everything
    this.lbGraphics = null;     // background + gridlines
    this.lbMedals = [];         // medal Image per row
    this.lbNameTexts = [];      // Text per row
    this._lastRankedHash = "";  // dirty check to avoid redrawing every frame

    // Resize handling
    this._onResize = null;
    this._lastW = -1;
    this._lastH = -1;

    // HUD buttons
    this._leaveBtnBg = null;
    this._leaveBtnIcon = null;
    this._settingsBtnBg = null;
    this._settingsBtnIcon = null;
    this._settingsOverlay = null;
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

    // Medal images for leaderboard
    for (let i = 1; i <= LB_MAX_MEDALS; i++) {
      const key = `medal_${i}`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `assets/images/${key}.png`);
      }
    }

    // Health bar images
    if (!this.textures.exists(HEALTH_BG_KEY)) {
      this.load.image(HEALTH_BG_KEY, encodeURI(HEALTH_BG_SRC));
    }
    if (!this.textures.exists(HEALTH_SEG_KEY)) {
      this.load.image(HEALTH_SEG_KEY, encodeURI(HEALTH_SEG_SRC));
    }
  }

  create() {
    // Transparent overlay
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");

    // Round pixels to avoid tiny shimmer from sub-pixel placement
    this.cameras.main.setRoundPixels(true);

    this.createHealthBar();
    this.createTimer();
    this.createLeaderboard();
    this._createHudButtons();

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
    this.healthBg = null;
    this.healthMarkers = [];

    this.timerContainer = null;
    this.timerSprites = [];
    this._lastTimerText = "";

    for (const m of this.lbMedals) { try { m.destroy(); } catch (_) {} }
    for (const t of this.lbNameTexts) { try { t.destroy(); } catch (_) {} }
    try { this.lbGraphics?.destroy(); } catch (_) {}
    try { this.lbContainer?.destroy(true); } catch (_) {}

    this.lbContainer = null;
    this.lbGraphics = null;
    this.lbMedals = [];
    this.lbNameTexts = [];
    this._lastRankedHash = "";

    try { this._settingsOverlay?.destroy(); } catch (_) {}
    this._settingsOverlay = null;
    try { this._leaveBtnBg?.destroy(); } catch (_) {}
    try { this._leaveBtnIcon?.destroy(); } catch (_) {}
    try { this._settingsBtnBg?.destroy(); } catch (_) {}
    try { this._settingsBtnIcon?.destroy(); } catch (_) {}
    this._leaveBtnBg = null;
    this._leaveBtnIcon = null;
    this._settingsBtnBg = null;
    this._settingsBtnIcon = null;
  }

  // -----------------------------
  // HUD action buttons (top-left): Leave + Settings
  // -----------------------------
  _createHudButtons() {
    const x1 = HUD_BTN_MARGIN + HUD_BTN_SIZE / 2;
    const y = HUD_BTN_MARGIN + HUD_BTN_SIZE / 2;
    const x2 = x1 + HUD_BTN_SIZE + HUD_BTN_GAP;

    // ---- Leave button ----
    this._leaveBtnBg = this.add.rectangle(x1, y, HUD_BTN_SIZE, HUD_BTN_SIZE, HUD_BTN_COLOR, HUD_BTN_ALPHA)
      .setStrokeStyle(2, HUD_BTN_STROKE, 1)
      .setDepth(HUD_BTN_DEPTH)
      .setInteractive({ useHandCursor: true });
    this._leaveBtnIcon = this.add.text(x1, y, "\u2190", HUD_BTN_FONT)
      .setOrigin(0.5).setDepth(HUD_BTN_DEPTH + 1);

    this._leaveBtnBg.on("pointerover", () => this._leaveBtnBg.setFillStyle(HUD_BTN_HOVER, 1));
    this._leaveBtnBg.on("pointerout", () => this._leaveBtnBg.setFillStyle(HUD_BTN_COLOR, HUD_BTN_ALPHA));
    this._leaveBtnBg.on("pointerdown", () => this._leaveGame());

    // ---- Settings button ----
    this._settingsBtnBg = this.add.rectangle(x2, y, HUD_BTN_SIZE, HUD_BTN_SIZE, HUD_BTN_COLOR, HUD_BTN_ALPHA)
      .setStrokeStyle(2, HUD_BTN_STROKE, 1)
      .setDepth(HUD_BTN_DEPTH)
      .setInteractive({ useHandCursor: true });
    this._settingsBtnIcon = this.add.text(x2, y, "\u2699", HUD_BTN_FONT)
      .setOrigin(0.5).setDepth(HUD_BTN_DEPTH + 1);

    this._settingsBtnBg.on("pointerover", () => this._settingsBtnBg.setFillStyle(HUD_BTN_HOVER, 1));
    this._settingsBtnBg.on("pointerout", () => this._settingsBtnBg.setFillStyle(HUD_BTN_COLOR, HUD_BTN_ALPHA));
    this._settingsBtnBg.on("pointerdown", () => this._openSettings());

    // Settings overlay instance
    this._settingsOverlay = new SettingsOverlay(this);
    this._settingsOverlay.onClose = (settings) => {
      const gameScene = this.scene.get(this.gameSceneKey);
      // Apply volume to the game scene's sound manager
      if (gameScene?.sound) gameScene.sound.volume = settings.volume;
      // Send tilt sensitivity to server
      try { gameScene?.room?.send("settings", { tiltSensitivity: settings.tiltSensitivity }); } catch (_) {}
    };
  }

  _leaveGame() {
    const gameScene = this.scene.get(this.gameSceneKey);
    const username = gameScene?._username || "Player";
    const skinId = gameScene?._skinId || "default";

    try { gameScene?.room?.leave(); } catch (_) {}
    this.scene.stop("UIScene");
    this.scene.stop(this.gameSceneKey);
    this.scene.start("MainMenuScene", { username, skinId });
  }

  _openSettings() {
    if (this._settingsOverlay?.isOpen) return;
    this._settingsOverlay?.open();
  }

  // -----------------------------
  // Health bar creation (IMAGE + 40 MARKERS)
  // -----------------------------
  createHealthBar() {
    // Force pixel-art filtering (prevents seams/blur when scaling).
    try {
      this.textures.get(HEALTH_BG_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.textures.get(HEALTH_SEG_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
    } catch (_) {
      // If Phaser version differs, ignore — camera roundPixels still helps.
    }

    // Background (heart + empty bar)
    this.healthBg = this.add.image(0, 0, HEALTH_BG_KEY);
    this.healthBg.setOrigin(0.5, 0.5);

    // Source sizes (not display sizes)
    const bgW = this.healthBg.width;
    const bgH = this.healthBg.height;

    // Inner rect in LOCAL coords (relative to bg center)
    const innerLeft = -bgW / 2 + HEALTH_INNER_X0;
    const innerTop = -bgH / 2 + HEALTH_INNER_Y0;

    const innerW = HEALTH_INNER_W;
    const innerH = HEALTH_INNER_H;

    // Marker texture is exactly 10x80 (per your image)
    const markerW = 10;
    const markerH = 80;

    // Vertical center of the inner box
    const innerCenterY = innerTop + innerH / 2;

    // Create 40 marker images and place them left-to-right inside the inner box
    this.healthMarkers = [];
    for (let i = 0; i < HEALTH_SEG_COUNT; i++) {
      const m = this.add.image(0, 0, HEALTH_SEG_KEY);

      // Left-anchored, vertically centered
      m.setOrigin(0, 0.5);

      // No per-marker scaling needed (10x80 fits perfectly)
      m.setScale(1, 1);

      // Exact 10px step: 40 * 10 = 400 (perfect fit)
      m.x = Math.round(innerLeft + i * markerW);
      m.y = Math.round(innerCenterY);

      m.setVisible(false);
      this.healthMarkers.push(m);
    }

    // Put bg + markers into one container and scale the whole thing with ONE knob
    this.healthBar = this.add.container(0, 0, [this.healthBg, ...this.healthMarkers]);
    this.healthBar.setScale(HEALTH_UI_SCALE);
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

  // -----------------------------
  // Leaderboard creation
  // -----------------------------
  createLeaderboard() {
    // Force pixel-art filtering on medal textures
    for (let i = 1; i <= LB_MAX_MEDALS; i++) {
      try {
        this.textures.get(`medal_${i}`).setFilter(Phaser.Textures.FilterMode.NEAREST);
      } catch (_) {}
    }

    this.lbContainer = this.add.container(0, 0);
    this.lbContainer.setDepth(LB_DEPTH);
    this.lbContainer.setVisible(false);

    this.lbGraphics = this.add.graphics();
    this.lbContainer.add(this.lbGraphics);

    this._lbRowsByPlayer = new Map(); // sid -> { nameText }
  }

  // Route leaderboard updates: hard rebuild when player count changes, animate otherwise.
  _updateLeaderboard(gameScene, w, h) {
    if (!this.lbContainer || !this.lbGraphics) return;

    const ranked = gameScene?.getRankedPlayers?.() || [];
    if (ranked.length === 0) {
      this.lbContainer.setVisible(false);
      return;
    }

    // Hash-based dirty check: only act when rankings actually change
    const hash = ranked.map((r) => `${r.sid}:${r.name}:${r.order}`).join("|");
    if (hash === this._lastRankedHash) return;

    const prevRowCount = this.lbNameTexts.length;
    this._lastRankedHash = hash;

    if (ranked.length !== prevRowCount) {
      // Player count changed — full rebuild, no animation
      this._rebuildLeaderboard(ranked, w, h);
    } else {
      // Only rank order changed — slide names to new positions
      this._animateLeaderboardSwap(ranked);
    }
  }

  // Full destroy-and-recreate of all leaderboard objects.
  _rebuildLeaderboard(ranked, w, h) {
    // Kill any in-progress swap tweens
    for (const row of this._lbRowsByPlayer.values()) {
      try { this.tweens.killTweensOf(row.nameText); } catch (_) {}
    }

    // Destroy old per-row objects
    for (const m of this.lbMedals) { try { m.destroy(); } catch (_) {} }
    for (const t of this.lbNameTexts) { try { t.destroy(); } catch (_) {} }
    this.lbMedals = [];
    this.lbNameTexts = [];
    this._lbRowsByPlayer.clear();

    const rowCount = ranked.length;
    const gridW = LB_MEDAL_COL_W_PX + LB_NAME_COL_W_PX;
    const totalW = LB_PADDING_PX + gridW + LB_PADDING_PX;
    const totalH = LB_PADDING_PX + rowCount * LB_ROW_H_PX + LB_PADDING_PX;

    // ---- Draw background + gridlines ----
    this.lbGraphics.clear();

    // White background
    this.lbGraphics.fillStyle(LB_BG_COLOR, LB_BG_ALPHA);
    this.lbGraphics.fillRoundedRect(0, 0, totalW, totalH, LB_CORNER_RADIUS);

    // Border
    this.lbGraphics.lineStyle(LB_GRID_LINE_W, LB_GRID_COLOR, LB_GRID_ALPHA);
    this.lbGraphics.strokeRoundedRect(0, 0, totalW, totalH, LB_CORNER_RADIUS);

    // Vertical line between medal and name columns
    const colLineX = LB_PADDING_PX + LB_MEDAL_COL_W_PX;
    this.lbGraphics.beginPath();
    this.lbGraphics.moveTo(colLineX, LB_PADDING_PX);
    this.lbGraphics.lineTo(colLineX, totalH - LB_PADDING_PX);
    this.lbGraphics.strokePath();

    // Horizontal lines between rows
    for (let i = 1; i < rowCount; i++) {
      const lineY = LB_PADDING_PX + i * LB_ROW_H_PX;
      this.lbGraphics.beginPath();
      this.lbGraphics.moveTo(LB_PADDING_PX, lineY);
      this.lbGraphics.lineTo(totalW - LB_PADDING_PX, lineY);
      this.lbGraphics.strokePath();
    }

    // ---- Per-row: medal image + name text ----
    for (let i = 0; i < rowCount; i++) {
      const entry = ranked[i];
      const rowCenterY = LB_PADDING_PX + i * LB_ROW_H_PX + LB_ROW_H_PX / 2;

      // Medal image (medal_1 for rank 1, medal_2 for rank 2, etc.)
      const medalIdx = Math.min(i + 1, LB_MAX_MEDALS);
      const medalKey = `medal_${medalIdx}`;
      const medalX = LB_PADDING_PX + LB_MEDAL_COL_W_PX / 2;

      if (this.textures.exists(medalKey)) {
        const medal = this.add.image(medalX, rowCenterY, medalKey);
        medal.setOrigin(0.5, 0.5);
        medal.setScale(LB_MEDAL_SCALE);
        this.lbContainer.add(medal);
        this.lbMedals.push(medal);
      }

      // Player name text
      const nameX = colLineX + 8;
      const displayName = entry.name.length > 14
        ? entry.name.slice(0, 13) + "\u2026"
        : entry.name;

      const nameText = this.add.text(nameX, rowCenterY, displayName, {
        fontFamily: LB_NAME_FONT_FAMILY,
        fontSize: `${LB_NAME_FONT_SIZE_PX}px`,
        color: LB_NAME_COLOR,
      });
      nameText.setOrigin(0, 0.5);
      this.lbContainer.add(nameText);
      this.lbNameTexts.push(nameText);
      this._lbRowsByPlayer.set(entry.sid, { nameText });
    }

    // Position and show
    this._layoutLeaderboard(w, h, rowCount);
    this.lbContainer.setVisible(true);
  }

  // Slide existing name texts to their new rank positions.
  _animateLeaderboardSwap(ranked) {
    ranked.forEach((entry, i) => {
      const row = this._lbRowsByPlayer.get(entry.sid);
      if (!row) return;
      const targetY = LB_PADDING_PX + i * LB_ROW_H_PX + LB_ROW_H_PX / 2;
      this.tweens.killTweensOf(row.nameText);
      this.tweens.add({
        targets: row.nameText,
        y: targetY,
        duration: LB_SWAP_DURATION_MS,
        ease: 'Power2',
      });
    });
  }

  // Position the leaderboard container at the bottom-right corner.
  _layoutLeaderboard(w, h, rowCount) {
    if (!this.lbContainer) return;
    if (rowCount == null) {
      // Infer from current content
      rowCount = this.lbNameTexts.length;
    }
    if (rowCount <= 0) return;

    const gridW = LB_MEDAL_COL_W_PX + LB_NAME_COL_W_PX;
    const totalW = LB_PADDING_PX + gridW + LB_PADDING_PX;
    const totalH = LB_PADDING_PX + rowCount * LB_ROW_H_PX + LB_PADDING_PX;

    this.lbContainer.x = Math.round(w - totalW - LB_MARGIN_RIGHT_PX);
    this.lbContainer.y = Math.round(h - totalH - LB_MARGIN_BOTTOM_PX);
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
    if (!localPlayer) {
      if (this.healthBar) this.healthBar.setVisible(false);
    } else if (this.healthBar && this.healthBg && this.healthMarkers.length === HEALTH_SEG_COUNT) {
      // Position once when resized
      if (force || w !== this._lastW || h !== this._lastH) {
        // Use SOURCE size * container scale (container scaling doesn't change child displayWidth).
        const barW = this.healthBg.width * HEALTH_UI_SCALE;
        const barH = this.healthBg.height * HEALTH_UI_SCALE;

        // Bottom-left anchor (tweak HEALTH_UI_BL_X / HEALTH_UI_BL_Y)
        this.healthBar.x = Math.round(HEALTH_UI_BL_X + barW / 2);
        this.healthBar.y = Math.round(h - HEALTH_UI_BL_Y - barH / 2);

        this._lastW = w;
        this._lastH = h;
      }

      const mh = Math.max(1, Number(localPlayer.maxHealth) || 100);
      const hp = Math.max(0, Math.min(mh, Number(localPlayer.health) || 0));
      const ratio = clamp01(hp / mh);

      // Markers shown: 0..40
      let shown = Math.floor(ratio * HEALTH_SEG_COUNT);
      if (hp >= mh) shown = HEALTH_SEG_COUNT;
      if (shown < 0) shown = 0;
      if (shown > HEALTH_SEG_COUNT) shown = HEALTH_SEG_COUNT;

      for (let i = 0; i < HEALTH_SEG_COUNT; i++) {
        this.healthMarkers[i].setVisible(i < shown);
      }

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

    // -------------------------
    // Leaderboard (bottom-right)
    // -------------------------
    this._updateLeaderboard(gameScene, w, h);

    if (force) {
      this._layoutLeaderboard(w, h);
    }
  }

  update() {
    this.ui(false);
  }
}