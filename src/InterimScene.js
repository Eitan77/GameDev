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
import { SKIN_CATALOG } from "./skinCatalog.js";

// Safety timeout (ms): if the server never sends "interimEnd"
// (e.g. server crash / lost connection), transition anyway.
const INTERIM_SAFETY_MS = 15_000;

// Client-side minimum display floor (ms).
// Even if the server sends "interimEnd" immediately (e.g. all assets
// are cached and the client sends "interimReady" before _startInterim
// runs on the server), we will NOT transition before this much time has
// elapsed since assets finished loading.  This is the final safety net
// that prevents the screen from flashing away in under a second.
const MIN_LOCAL_DISPLAY_MS = 2_500;

// ── Curtain transition timings (ms) ──
const CURTAIN_IN_MS  = 200;   // entering interim: black cover slides off screen
const CURTAIN_OUT_MS = 200;   // leaving interim:  black cover slides onto screen

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
const SCORE_BELOW_FRAME_PX = FRAME_INNER_H / 2 + 220;
// Uniform scale applied to every digit sprite
const DIGIT_SCALE = 2;
// Horizontal gap (px, at native resolution) between adjacent digit sprites
const DIGIT_GAP_PX = 3;

// ── Player name labels ──
// Positive Y = further below the frame centre; negative = above.
const NAME_OFFSET_Y_PX   = -(FRAME_INNER_H / 2 + 100);  // above the frame
const NAME_FONT_SIZE_PX  = 40;
const NAME_FONT_FAMILY   = "Arial, sans-serif";
const NAME_COLOR         = "#ffffff";
const NAME_STROKE_COLOR  = "#000000";
const NAME_STROKE_WIDTH  = 10;
const NAME_DEPTH         = 15;

// ── Crown (game-over winner indicator) ──
const CROWN_OFFSET_Y_PX  = -(FRAME_INNER_H / 2);   // above the head frame
const CROWN_SCALE        = 1.0;
const CROWN_DEPTH        = 16;

// ── Return to Lobby button (game-over screen) ──
const LOBBY_BTN_Y_PX     = 730;   // near bottom of 800px canvas
const LOBBY_BTN_W        = 420;
const LOBBY_BTN_H        = 72;
const LOBBY_BTN_COLOR    = 0x1a1a2e;
const LOBBY_BTN_HOVER    = 0x2a2a4e;
const LOBBY_BTN_BORDER   = 0xffd700;
const LOBBY_BTN_FONT_SZ  = 38;

export default class InterimScene extends Phaser.Scene {
  constructor() {
    super("InterimScene");

    this._room        = null;
    this._client      = null;
    this._username    = "Player";
    this._playerCount = 1;

    this._scores      = null;

    this._assetsReady       = false;
    this._interimEndReceived = false;
    this._readySent          = false;
    this._transitioning      = false;
  }

  init(data) {
    this._room      = data?.room     ?? null;
    this._client    = data?.client   ?? null;
    this._username  = data?.username ?? "Player";
    this._skinId    = data?.skinId   ?? "default";
    this._gameOver  = data?.gameOver ?? false;
    this._winnerId  = data?.winnerId ?? null;
    this._nextMapName = "level1"; // updated when interimEnd arrives

    // ── Reset all transition flags here (before preload) ──
    this._assetsReady        = false;
    this._interimEndReceived = false;
    this._readySent          = false;
    this._transitioning      = false;
    this._skipLocalMin       = false;

    // Client-side minimum display floor tracking.
    // Set to Date.now() when assets finish loading; used in _tryTransition.
    this._localReadyTime = 0;
    clearTimeout(this._localMinTimer);
    this._localMinTimer  = null;

    // ── Visibility handler ──
    // Phaser's RAF loop pauses when the tab is hidden. If "interimEnd"
    // arrived while hidden, scene.start() was queued but never processed.
    // When the user tabs back in, retry the transition — it's a no-op if
    // it already completed, and the correct action if it didn't.
    if (this._visibilityHandler) {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    }
    this._visibilityHandler = () => {
      if (document.hidden) return;
      if (!this._interimEndReceived) return;
      // Reset the guard so _tryTransition can fire again if Phaser dropped
      // the previous scene.start() while the loop was paused.
      this._transitioning = false;
      this._tryTransition();
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);

    // ── Register "interimEnd" listener here (before preload) ──
    // If registered in create() instead, the message could theoretically
    // arrive between load.complete (which sends "interimReady") and
    // create() executing, and be silently dropped.
    if (this._room) {
      this._room.onMessage("interimEnd", (msg) => {
        this._interimEndReceived = true;
        if (msg?.mapName) this._nextMapName = msg.mapName;
        console.log("[InterimScene] interimEnd received, next map:", this._nextMapName);
        if (msg?.lateJoin) this._skipLocalMin = true;
        this._tryTransition();
      });
    }

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
    this.load.image("crown",       "assets/images/crown.png");

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

    GameMap.preload(this); // no mapName arg = preload all maps
    preloadGuns(this);

    this.load.on("complete", () => {
      this._localReadyTime = Date.now();
      this._assetsReady = true;
      this._trySendReady();
      this._tryTransition();
    });

    // If nothing needed loading (all cached), Phaser may skip load.complete.
    // Mark ready now so create()'s failsafe _trySendReady() call will fire.
    this.load.once(Phaser.Loader.Events.START, () => { /* loading did start */ });
    if (!this.load.isLoading() && this.load.totalToLoad === 0) {
      this._localReadyTime = Date.now();
      this._assetsReady = true;
    }
  }

  // -------------------------------------------------------------------
  // create — show the board; start the minimum-display timer
  // -------------------------------------------------------------------
  create() {
    const W = this.scale.width;   // 1600
    const H = this.scale.height;  // 800

    this.input.on("gameobjectdown", () => this.sound.play("click", { volume: 2 }));

    // ── Resolve player names now (create() runs after state is settled) ──
    // _scores may have been built in init() before setName was reflected back
    // from the server. Re-read names here so they're always up to date.
    // Priority: explicit scores array (from roundOver) > live room state > fallback.
    const resolvedNames = this._buildResolvedNames();

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

      // ── Skin tint ──
      const entry  = this._scores ? this._scores[i] : null;
      let skinId = entry?.skinId || "default";
      // If no skinId in scores, try live room state
      if (skinId === "default" && this._room?.state?.players) {
        let idx = 0;
        this._room.state.players.forEach((st) => {
          if (idx === i && st.skinId) skinId = st.skinId;
          idx++;
        });
      }
      const skinDef = SKIN_CATALOG[skinId];
      if (skinDef?.tint) head.setTint(skinDef.tint);

      // ── Player name ──
      const name   = resolvedNames[i] || entry?.name || "Player";
      const points = entry ? Math.max(0, Number(entry.points) || 0) : 0;

      this.add.text(frame.x, frame.y + NAME_OFFSET_Y_PX, name, {
        fontFamily: NAME_FONT_FAMILY,
        fontSize:   `${NAME_FONT_SIZE_PX}px`,
        color:      NAME_COLOR,
        stroke:     NAME_STROKE_COLOR,
        strokeThickness: NAME_STROKE_WIDTH,
      }).setOrigin(0.5, 0.5).setDepth(NAME_DEPTH);

      // ── Score for this slot ──
      // Default to 0 if we have no scores yet (first pre-game interim).
      this._drawScoreDigits(frame.x, frame.y + SCORE_BELOW_FRAME_PX, points);

      // ── Crown: shown over the winner on the game-over screen ──
      if (this._gameOver && entry && entry.sid === this._winnerId) {
        if (this.textures.exists("crown")) {
          const crown = this.add.image(frame.x, frame.y + CROWN_OFFSET_Y_PX, "crown");
          crown.setScale(CROWN_SCALE).setDepth(CROWN_DEPTH);
        }
      }
    }

    // ── Return to Lobby button (game-over only) ──
    if (this._gameOver) {
      const cx = W / 2;
      const bg = this.add.rectangle(cx, LOBBY_BTN_Y_PX, LOBBY_BTN_W, LOBBY_BTN_H, LOBBY_BTN_COLOR)
        .setDepth(20)
        .setStrokeStyle(3, LOBBY_BTN_BORDER);

      const label = this.add.text(cx, LOBBY_BTN_Y_PX, "RETURN TO LOBBY", {
        fontFamily: NAME_FONT_FAMILY,
        fontSize:   `${LOBBY_BTN_FONT_SZ}px`,
        color:      "#ffd700",
        stroke:     "#000000",
        strokeThickness: 6,
      }).setOrigin(0.5, 0.5).setDepth(21);

      bg.setInteractive({ useHandCursor: true });
      bg.on("pointerover",  () => bg.setFillStyle(LOBBY_BTN_HOVER));
      bg.on("pointerout",   () => bg.setFillStyle(LOBBY_BTN_COLOR));
      bg.on("pointerdown",  () => {
        bg.removeAllListeners();
        try { this._room?.leave(); } catch (_) {}
        this.scene.start("MainMenuScene");
      });
    }

    // ── Entrance curtain: starts covering the screen, sweeps down to reveal ──
    const curtainIn = this.add.rectangle(0, 0, W, H, 0x000000, 1)
      .setOrigin(0, 0)
      .setDepth(100);
    this.tweens.add({
      targets: curtainIn,
      y: H,
      duration: CURTAIN_IN_MS,
      ease: "Power2",
      onComplete: () => { try { curtainIn.destroy(); } catch (_) {} },
    });

    // Safety: if the server never responds (crash / disconnect), don't
    // strand the player on the interim screen forever.
    this.time.delayedCall(INTERIM_SAFETY_MS, () => {
      if (!this._transitioning) {
        console.warn("[InterimScene] Safety timeout — server did not send interimEnd.");
        this._interimEndReceived = true;
        this._tryTransition();
      }
    });

    // Failsafe: if preload's load.complete somehow didn't fire (all assets
    // were already cached and Phaser skipped the loader), send ready now.
    this._trySendReady();
    this._tryTransition();
  }

  // -------------------------------------------------------------------
  // _buildResolvedNames
  // Returns an array of display names, one per player slot, with the
  // best available source at the time create() runs.
  //
  // Sources in priority order:
  //   1. Explicit scores array passed in via roundOver (most reliable)
  //   2. Live room.state.players (settled by create() time)
  //   3. this._username for the local player (always known)
  //   4. "Player" fallback
  // -------------------------------------------------------------------
  _buildResolvedNames() {
    const names = [];

    // Source 1: explicit scores array (between-round interims)
    if (Array.isArray(this._scores) && this._scores.length > 0) {
      for (const entry of this._scores) {
        names.push(entry?.name && entry.name !== "Player" ? entry.name : null);
      }
    }

    // Source 2: live room state (first-game interim — names settle by create())
    if (this._room?.state?.players) {
      let idx = 0;
      this._room.state.players.forEach((st) => {
        const liveState = st.name && st.name !== "Player" ? st.name : null;
        // Override the slot if we got a better name from live state
        if (liveState && !names[idx]) names[idx] = liveState;
        else if (names[idx] === undefined) names[idx] = liveState;
        idx++;
      });
    }

    // Source 3: local username — find which slot belongs to us and fill it
    if (this._username && this._username !== "Player" && this._room?.state?.players) {
      let idx = 0;
      this._room.state.players.forEach((st, sid) => {
        if (!names[idx] && st.name === this._username) names[idx] = this._username;
        // If state still shows default, the local player is identifiable by room sessionId
        if (!names[idx] && this._room.sessionId === sid) names[idx] = this._username;
        idx++;
      });
    }

    return names;
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
  // _trySendReady
  // Called when assets finish loading. Signals the server that this
  // client is ready to leave the interim screen.
  // -------------------------------------------------------------------
  _trySendReady() {
    if (!this._assetsReady) return;
    if (!this._room)        return;
    if (this._readySent)    return;
    this._readySent = true;
    try {
      this._room.send("interimReady");
    } catch (_) {}
  }

  // -------------------------------------------------------------------
  _tryTransition() {
    // Game-over screen: player stays until they click "Return to Lobby".
    if (this._gameOver) return;
    if (!this._assetsReady || !this._interimEndReceived) return;
    if (this._transitioning) return;

    // Client-side minimum display floor: don't transition until the screen
    // has been visible for at least MIN_LOCAL_DISPLAY_MS.  This prevents
    // a "flash" when all assets are cached (load.complete fires before
    // create() runs) or when the server sends "interimEnd" too early.
    // Skip entirely for late-joining clients (server already moved on).
    if (!this._skipLocalMin) {
      const elapsed = this._localReadyTime > 0 ? Date.now() - this._localReadyTime : 0;
      if (elapsed < MIN_LOCAL_DISPLAY_MS) {
        clearTimeout(this._localMinTimer);
        this._localMinTimer = setTimeout(
          () => this._tryTransition(),
          MIN_LOCAL_DISPLAY_MS - elapsed + 10,
        );
        return;
      }
    }

    this._transitioning = true;
    clearTimeout(this._localMinTimer);
    this._localMinTimer = null;

    // Remove the visibility handler — no longer needed once we transition.
    if (this._visibilityHandler) {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
      this._visibilityHandler = null;
    }

    // ── Exit curtain: sweeps down from top to cover screen, then transition ──
    const W = this.scale.width;
    const H = this.scale.height;
    const curtainOut = this.add.rectangle(0, -H, W, H, 0x000000, 1)
      .setOrigin(0, 0)
      .setDepth(100);
    this.tweens.add({
      targets: curtainOut,
      y: 0,
      duration: CURTAIN_OUT_MS,
      ease: "Power2",
      onComplete: () => {
        this.scene.start("GameScene", {
          room:     this._room,
          client:   this._client,
          username: this._username,
          skinId:   this._skinId,
          mapName:  this._nextMapName || "level1",
        });
      },
    });
  }
}