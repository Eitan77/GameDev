// InterimScene.js
// =============================================================
// Shown between MatchmakingScene and GameScene.
//
// Responsibilities:
//   1. Load ALL game assets (so GameScene.preload() is a no-op).
//   2. Display the ranking-board background (InterimScreen.png).
//   3. Place each connected player's head image in the correct
//      gold frame, centred across the active slots only.
//   4. Show pixel-art score digits (timer_0…timer_9) under each frame.
//   5. Wait at least MIN_DISPLAY_MS, then hand off to GameScene.
// =============================================================

import Phaser from "phaser";
import GameMap  from "./GameMap.js";
import { preloadGuns } from "./gunCatalog.js";

// How long to show the screen (ms). Assets must ALSO be done before
// we move on — whichever takes longer wins.
const MIN_DISPLAY_MS = 3000;

// ── Frame geometry (measured from the 1600×800 InterimScreen.png) ──
// White-rectangle centres and inner size in image-pixels.
// The canvas is also 1600×800, so these are direct screen coords.
const FRAMES = [
  { x: 248,  y: 316 },
  { x: 616,  y: 316 },
  { x: 983,  y: 316 },
  { x: 1351, y: 316 },
];
const FRAME_INNER_W = 227;
const FRAME_INNER_H = 269;

// ── Score digit display ──
// Y position for the score block (pixels below the frame centre)
const SCORE_BELOW_FRAME_PX = FRAME_INNER_H / 2 + 28;
// Uniform scale applied to every digit sprite
const DIGIT_SCALE = 1.4;
// Horizontal gap (px, at native resolution) between adjacent digit sprites
const DIGIT_GAP_PX = 3;

export default class InterimScene extends Phaser.Scene {
  constructor() {
    super("InterimScene");

    this._room        = null;
    this._client      = null;
    this._username    = "Player";
    this._playerCount = 1;

    this._scores      = null;

    this._assetsReady  = false;
    this._timerDone    = false;
    this._transitioning = false;
  }

  init(data) {
    this._room     = data?.room     ?? null;
    this._client   = data?.client   ?? null;
    this._username = data?.username ?? "Player";

    // ── Build scores from room state whenever possible ──
    // Works for both the initial interim (all 0s) and post-round interims
    // (updated points). Explicit scores passed in by roundOver take priority;
    // otherwise we read live from room.state.players.
    if (Array.isArray(data?.scores) && data.scores.length > 0) {
      this._scores      = data.scores;
      this._playerCount = Math.max(1, Math.min(4, this._scores.length));
    } else if (this._room?.state?.players) {
      this._scores = [];
      this._room.state.players.forEach((st, sid) => {
        this._scores.push({ sid, name: st.name || "Player", points: Number(st.points) || 0 });
      });
      this._playerCount = Math.max(1, Math.min(4, this._scores.length || Number(data?.playerCount) || 1));
    } else {
      // Fallback: state not available yet, use matchmaking count
      this._scores      = null;
      this._playerCount = Math.max(1, Math.min(4, Number(data?.playerCount) || 1));
    }
  }

  // -------------------------------------------------------------------
  // preload — load ALL game assets here so GameScene.preload is a no-op
  // -------------------------------------------------------------------
  preload() {
    // Interim-screen assets
    this.load.image("interim_bg",  "assets/images/InterimScreen.png");
    this.load.image("player_head", "assets/images/PlayerHead.png");

    // Score digit sprites (same keys as UIScene timer digits)
    for (let d = 0; d <= 9; d++) {
      if (!this.textures.exists(`timer_${d}`)) {
        this.load.image(`timer_${d}`, `assets/images/timer_${d}.png`);
      }
    }

    // GameScene assets
    this.load.image("player",     "assets/images/player.png");
    this.load.image("arm",        "assets/images/arm.png");
    this.load.image("checkpoint", "assets/images/checkpoint.png");

    GameMap.preload(this);
    preloadGuns(this);

    // Progress bar while assets load
    const W = this.scale.width;
    const H = this.scale.height;

    const barBg = this.add.rectangle(W / 2, H - 32, W * 0.5, 12, 0x2d3342).setDepth(10);
    const bar   = this.add.rectangle(W / 2 - (W * 0.25), H - 32, 0, 10, 0x88aaff).setDepth(11).setOrigin(0, 0.5);

    this.load.on("progress", (value) => {
      bar.width = W * 0.5 * value;
    });

    this.load.on("complete", () => {
      barBg.destroy();
      bar.destroy();
      this._assetsReady = true;
      this._tryTransition();
    });
  }

  // -------------------------------------------------------------------
  // create — show the board; start the minimum-display timer
  // -------------------------------------------------------------------
  create() {
    // Reset transition guard every time the scene starts
    this._transitioning = false;
    this._assetsReady   = false;
    this._timerDone     = false;

    const W = this.scale.width;   // 1600
    const H = this.scale.height;  // 800

    // ── Background ──
    this.add.image(0, 0, "interim_bg").setOrigin(0, 0);

    // ── Only render as many frames as there are players ──
    // Centre the active slots: e.g. 2 players → slots 1 & 2 (0-indexed)
    const count  = this._playerCount;                       // 1..4
    const offset = Math.floor((4 - count) / 2);            // left-pad

    for (let i = 0; i < count; i++) {
      const slot  = offset + i;
      const frame = FRAMES[slot];

      // ── Player head ──
      const head = this.add.image(frame.x, frame.y, "player_head");
      const scale = Math.min(
        FRAME_INNER_W / head.width,
        FRAME_INNER_H / head.height
      );
      head.setScale(scale).setDepth(3);

      // ── Score for this slot ──
      // Default to 0 if we have no scores yet (first pre-game interim).
      const entry  = this._scores ? this._scores[i] : null;
      const points = entry ? Math.max(0, Number(entry.points) || 0) : 0;

      this._drawScoreDigits(frame.x, frame.y + SCORE_BELOW_FRAME_PX, points);
    }

    // ── Minimum-display timer ──
    this.time.delayedCall(MIN_DISPLAY_MS, () => {
      this._timerDone = true;
      this._tryTransition();
    });

    // Edge-case: preload() already finished before create() ran
    // (all assets were cached — happens on subsequent rounds).
    if (!this.load.isLoading()) {
      this._assetsReady = true;
    }
    this._tryTransition();
  }

  // -------------------------------------------------------------------
  // _drawScoreDigits
  // Renders `score` using pixel-art digit sprites, horizontally centred
  // around (cx, cy).  Supports any non-negative integer.
  // -------------------------------------------------------------------
  _drawScoreDigits(cx, cy, score) {
    const digits = String(Math.max(0, score | 0));  // e.g. "0", "3", "12"

    // Measure total width at the chosen scale so we can centre the group.
    let totalW = 0;
    const spriteWidths = [];

    for (const ch of digits) {
      const key = `timer_${ch}`;
      // If the texture hasn't loaded yet fall back to a reasonable estimate.
      const tex = this.textures.exists(key) ? this.textures.get(key) : null;
      const w   = tex ? tex.getSourceImage().width * DIGIT_SCALE : 18 * DIGIT_SCALE;
      spriteWidths.push(w);
      totalW += w;
    }
    // Add gaps between digits (not after the last one)
    totalW += DIGIT_GAP_PX * DIGIT_SCALE * Math.max(0, digits.length - 1);

    // Place digits left-to-right, centred on cx
    let x = cx - totalW / 2;

    for (let d = 0; d < digits.length; d++) {
      const key = `timer_${digits[d]}`;
      if (!this.textures.exists(key)) {
        x += spriteWidths[d] + DIGIT_GAP_PX * DIGIT_SCALE;
        continue;
      }

      const img = this.add.image(x, cy, key);
      img.setOrigin(0, 0.5);
      img.setScale(DIGIT_SCALE);
      img.setDepth(5);

      x += spriteWidths[d] + DIGIT_GAP_PX * DIGIT_SCALE;
    }
  }

  // -------------------------------------------------------------------
  _tryTransition() {
    if (!this._assetsReady || !this._timerDone) return;
    if (this._transitioning) return;
    this._transitioning = true;

    this.scene.start("GameScene", {
      room:     this._room,
      client:   this._client,
      username: this._username,
    });
  }
}

