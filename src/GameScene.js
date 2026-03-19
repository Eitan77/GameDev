// src/GameScene.js — render-only client scene

import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/schema";

import GameMap from "./GameMap.js";
import Player from "./player.js";
import GunPowerUp from "./GunPowerUp.js";
import { preloadGuns } from "./gunCatalog.js";
import VisibilityManager from "./VisibilityManager.js";
import { loadSettings } from "./settings.js";

// connects to same host (works on LAN); VITE_SERVER_URL overrides for production
const COLYSEUS_URL = import.meta.env.VITE_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:2567`;
const ROOM_NAME = "lobby";

export const NET_SEND_HZ = 60;

// ------------------------------------------------------------
// Curtain transition timing (ms)
// How long the black cover takes to slide off when the round starts.
// ------------------------------------------------------------
const COVER_SLIDE_OUT_MS = 600;

// ------------------------------------------------------------
// Camera tuning
// ------------------------------------------------------------
const CAMERA_ZOOM = 1.05;

const CAMERA_FOLLOW_LERP_X = 1;
const CAMERA_FOLLOW_LERP_Y = 1;

const CAMERA_DEADZONE_W_PX = 400;
const CAMERA_DEADZONE_H_PX = 260;

const CAMERA_DEADZONE_ANCHOR_X = 0.5;
const CAMERA_DEADZONE_ANCHOR_Y = 1;

const CAMERA_ROUND_PIXELS = false;

const MOUSE_GRAB_RADIUS_PX = 140;

// beam helper
const WHITE_PIXEL_KEY = "__white_pixel";

function ensureWhitePixelTexture(scene) {
  if (scene.textures.exists(WHITE_PIXEL_KEY)) return WHITE_PIXEL_KEY;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 2, 2);
  g.generateTexture(WHITE_PIXEL_KEY, 2, 2);
  g.destroy();
  return WHITE_PIXEL_KEY;
}

function redrawBeamMask(canvasTex, fadeFrontPx, tailLenPx) {
  const ctx = canvasTex.getContext();
  const w = canvasTex.width;
  const h = canvasTex.height;

  ctx.clearRect(0, 0, w, h);

  const f = Math.max(0, Math.min(w, fadeFrontPx));
  const tail = Math.max(1, Math.min(w, tailLenPx));
  const tailStart = Math.max(0, f - tail);

  if (w - f > 0.5) {
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.fillRect(f, 0, w - f, h);
  }

  if (f > 0.5) {
    const grad = ctx.createLinearGradient(tailStart, 0, f, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(tailStart, 0, f - tailStart, h);
  }

  canvasTex.refresh();
}

function extractMessageProperty(msg, shortKey, longKey, defaultValue) {
  return msg?.[shortKey] ?? msg?.[longKey] ?? defaultValue;
}

function destroyAllInCollection(collection) {
  for (const entity of collection.values()) {
    try {
      entity.destroy?.();
    } catch (_) {}
  }
  collection.clear();
}

// Register property listeners on a state object.
// onChangeHandler: called when using onChange (or for all properties if not using onChange)
// propertyKeyOrHandlers: array of keys (use onChangeHandler for all) or object mapping keys to handlers
function registerStatePropertyListeners(callbacks, state, onChangeHandler, propertyKeyOrHandlers) {
  if (!state) return;

  if (Object.prototype.hasOwnProperty.call(state, "onChange")) {
    state.onChange = onChangeHandler;
  } else {
    if (Array.isArray(propertyKeyOrHandlers)) {
      for (const key of propertyKeyOrHandlers) {
        callbacks.listen(state, key, onChangeHandler);
      }
    } else if (typeof propertyKeyOrHandlers === "object") {
      for (const [key, handler] of Object.entries(propertyKeyOrHandlers)) {
        callbacks.listen(state, key, handler);
      }
    }
  }
}

function spawnBeam(scene, msg) {
  const sx = Number(msg?.sx) || 0;
  const sy = Number(msg?.sy) || 0;
  const ex = Number(msg?.ex) || 0;
  const ey = Number(msg?.ey) || 0;

  const widthPx = Math.max(1, extractMessageProperty(msg, "w", "widthPx", 10));
  const lifeSec = Math.max(0.01, extractMessageProperty(msg, "l", "lifeSec", 0.05));
  const tailLenPx = Math.max(10, extractMessageProperty(msg, "t", "tailLenPx", 200));
  const color = Number(extractMessageProperty(msg, "c", "color", 0xffffff));

  const len = Phaser.Math.Distance.Between(sx, sy, ex, ey);
  if (len < 2) return;

  const ang = Math.atan2(ey - sy, ex - sx);
  const whiteKey = ensureWhitePixelTexture(scene);

  const beamImg = scene.add.image(sx, sy, whiteKey);
  beamImg.setOrigin(0, 0.5);
  beamImg.setDisplaySize(len, widthPx);
  beamImg.setTint(color);
  beamImg.rotation = ang;
  beamImg.setDepth(99);

  const maskKey = `beam_mask_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const maskTex = scene.textures.createCanvas(
    maskKey,
    Math.max(2, Math.ceil(len)),
    Math.max(2, Math.ceil(widthPx))
  );

  const maskImg = scene.add.image(sx, sy, maskKey);
  maskImg.setOrigin(0, 0.5);
  maskImg.setDisplaySize(len, widthPx);
  maskImg.rotation = ang;
  maskImg.setVisible(false);

  const bm = new Phaser.Display.Masks.BitmapMask(scene, maskImg);
  beamImg.setMask(bm);

  redrawBeamMask(maskTex, 0, tailLenPx);

  const anim = { t: 0 };
  scene.tweens.add({
    targets: anim,
    t: 1,
    duration: lifeSec * 1000,
    ease: "Linear",
    onUpdate: () => redrawBeamMask(maskTex, anim.t * len, tailLenPx),
    onComplete: () => {
      if (beamImg?.scene) {
        beamImg.clearMask(true);
        beamImg.destroy();
      }
      if (maskImg?.scene) maskImg.destroy();
      if (scene?.textures?.exists(maskKey)) scene.textures.remove(maskKey);
    },
  });
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");

    this.client = null;
    this.room = null;

    this._reservation = null;
    this._clientFromMM = null;

    // If MatchmakingScene already consumed the reservation, we get the live Room instance here.
    this._roomFromMM = null;

    // username chosen in MainMenuScene (passed through MatchmakingScene)
    this._username = "Player";

    this.map = null;

    this.players = new Map();
    this.localPlayer = null;

    this.powerUps = new Map();

    // checkpoint marker sprites (no collision)
    this.checkpointSprites = [];

    // Leaderboard: tie-breaking data per player
    this.checkpointData = new Map(); // sid → { joinOrder, cpHitSeq }
    this._joinSeq = 0;    // monotonic counter for room join order (final fallback)
    this._cpHitSeq = 0;   // monotonic counter incremented each time any player upgrades a checkpoint

    this.dragActive = false;
    this.dragX = 0;
    this.dragY = 0;
    this.fireSeq = 0;

    this.netAcc = 0;
    this.lastSent = null;

    this.statusText = null;
    this.callbacks = null;

    // Black cover shown during scene init; removed once local player is live.
    this._coverOverlay = null;

    this._cleanupRegistered = false;
    // When transitioning to InterimScene mid-match, we keep the room alive.
    this._keepRoom = false;

    // Kill events queued for UIScene killfeed
    this._pendingKillEvents = [];

    // Tab-visibility manager: prevents audio catch-up when tab is restored.
    this.visibility = null;
  }

  init(data) {
    // comes from MatchmakingScene
    this._reservation = data?.reservation ?? null;
    this._clientFromMM = data?.client ?? null;

    // New (preferred) flow: MatchmakingScene consumes the seat reservation immediately.
    this._roomFromMM = data?.room ?? null;

    const raw = data?.username;
    const name = String(raw ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
    this._username = name || "Player";
    this._skinId = data?.skinId || "default";
    this._mapName = data?.mapName || "level1";
    this._cleanupRegistered = false;
  }

  preload() {
    this.load.image("player", "assets/images/player.png");
    this.load.image("arm", "assets/images/arm.png");

    // checkpoint marker image
    this.load.image("checkpoint", "assets/images/checkpoint.png");

    if (!this.cache.audio.exists("game_music")) {
      this.load.audio("game_music", "assets/audio/game_music.mp3");
    }

    GameMap.preload(this, this._mapName);
    preloadGuns(this);

    this.load.on("loaderror", (file) => {
      console.error("Asset failed to load:", file?.key, file?.src);
    });
  }

  // ------------------------------------------------------------
  // HUD overlay (UIScene)
  // - Runs as a separate Scene so it never jitters with camera movement.
  // - Draws health + timer.
  // ------------------------------------------------------------
  ensureUIScene() {
    const gameKey = this.sys?.settings?.key || "GameScene";

    try {
      if (this.scene.isActive("UIScene")) {
        const ui = this.scene.get("UIScene");
        if (ui && typeof ui.setGameSceneKey === "function") ui.setGameSceneKey(gameKey);
        this.scene.bringToTop("UIScene");
        return;
      }

      this.scene.launch("UIScene", { gameSceneKey: gameKey });
      this.scene.bringToTop("UIScene");
    } catch (e) {
      console.warn("Failed to start UIScene:", e);
    }
  }

  setupInputListeners() {
    // Drag input
    this.input.on("pointerdown", (pointer) => {
      if (!this.localPlayer?.sprite) return;
      if (this.localPlayer?.isDead) return;

      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const wx = wp.x;
      const wy = wp.y;

      const px = this.localPlayer.sprite.x;
      const py = this.localPlayer.sprite.y;

      const dx = wx - px;
      const dy = wy - py;

      if (dx * dx + dy * dy <= MOUSE_GRAB_RADIUS_PX * MOUSE_GRAB_RADIUS_PX) {
        this.dragActive = true;
        this.dragX = wx;
        this.dragY = wy;
      }
    });

    this.input.on("pointermove", (pointer) => {
      if (!this.dragActive) return;

      if (this.localPlayer?.isDead) {
        this.dragActive = false;
        return;
      }

      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.dragX = wp.x;
      this.dragY = wp.y;
    });

    const endDrag = () => (this.dragActive = false);
    this.input.on("pointerup", endDrag);
    this.input.on("pointerupoutside", endDrag);
  }

  async create() {
    // Prevent audio/event catch-up when the tab is restored from background.
    this.visibility = new VisibilityManager(this);

    // Apply user volume setting
    const settings = loadSettings();
    this.sound.volume = settings.volume;

    // Start game music
    if (this.cache.audio.exists("game_music")) {
      this._gameMusic = this.sound.add("game_music", { loop: true, volume: settings.musicVolume ?? 0.4 });
      this._gameMusic.play();
    }

    this.map = new GameMap(this, this._mapName).create();

    // Covers the world while we wait for the local player + camera to settle.
    // Removed (with a short fade) once the local player is confirmed live.
    const W = this.scale.width;
    const H = this.scale.height;
    this._coverOverlay = this.add.rectangle(0, 0, W, H, 0x000000, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(9999);

    // spawn checkpoint marker images at Tiled respawn points
    this.spawnCheckpointMarkers();

    this.statusText = this.add
      .text(20, 20, "Joining match...", { fontSize: "18px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(2000);

    this.keyTiltLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyTiltRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyFire = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    this.setupInputListeners();

    // Connect to the actual match room
    try {
      // reuse client from matchmaking if provided, otherwise create our own
      this.client = this._clientFromMM || new Client(COLYSEUS_URL);

      if (this._roomFromMM) {
        // ✅ Preferred flow: we already joined the room (even if this tab was in the background).
        this.room = this._roomFromMM;
      } else if (this._reservation) {
        // Back-compat flow: join here if we were handed only a reservation.
        this.room = await this.client.consumeSeatReservation(this._reservation);
      } else {
        // fallback (shouldn't happen in normal flow)
        this.room = await this.client.joinOrCreate(ROOM_NAME);
      }

      // IMPORTANT: Callbacks is NOT constructed with `new` in your project
      this.callbacks = Callbacks.get(this.room);

      this.statusText.setText(`Connected: ${COLYSEUS_URL}`);

      // Tell the server our username (server will store it in PlayerState.name)
      // Safe even if server hasn't implemented it yet (it will just ignore it).
      try {
        this.room.send("setName", { name: this._username, skinId: this._skinId });
      } catch (_) {}

      // Send tilt sensitivity setting to server
      try {
        const s = loadSettings();
        this.room.send("settings", { tiltSensitivity: s.tiltSensitivity });
      } catch (_) {}

      this.registerCleanup();
    } catch (e) {
      console.error("Failed to join game room:", e);
      this.statusText.setText(`Server offline at ${COLYSEUS_URL}`);
      return;
    }

    // Resize hook
    this.scale.on("resize", () => this.applyCameraTuning());

    // --- State bindings (players) ---
    const handlePlayerAdded = (playerState, sessionId, { allowReplace } = { allowReplace: true }) => {
      const isLocal = sessionId === this.room.sessionId;

      // prevent duplicate sprites (ghost look)
      const existing = this.players.get(sessionId);
      if (existing) {
        if (!allowReplace) return;
        existing.destroy();
        this.players.delete(sessionId);
      }

      const p = new Player({ scene: this, sessionId, isLocal });
      this.players.set(sessionId, p);

      // Track join order and checkpoint-hit order for leaderboard tie-breaking
      if (!this.checkpointData.has(sessionId)) {
        this.checkpointData.set(sessionId, { joinOrder: this._joinSeq++, cpHitSeq: Infinity });
      }

      p.setTargetFromState(playerState);

      if (isLocal) {
        this.localPlayer = p;

        // follow the ACTUAL player sprite
        this.cameras.main.startFollow(
          p.sprite,
          CAMERA_ROUND_PIXELS,
          CAMERA_FOLLOW_LERP_X,
          CAMERA_FOLLOW_LERP_Y
        );

        this.applyCameraTuning();

        // World is ready — slide out the cover, then launch HUD on top.
        this._removeCoverOverlay(() => this.ensureUIScene());
      }

      const playerRefresh = () => p.setTargetFromState(playerState);

      registerStatePropertyListeners(
        this.callbacks,
        playerState,
        playerRefresh,
        [
          "name",
          "x",
          "y",
          "a",
          "armX",
          "armY",
          "armA",
          "dir",
          "gunId",
          "ammo",
          "maxHealth",
          "health",
          "dead",
          "gunX",
          "gunY",
          "gunA",
          "skinId",
        ]
      );

      // When cpOrder increases, record the sequence so first-to-reach wins ties.
      this.callbacks.listen(playerState, "cpOrder", (newVal, prevVal) => {
        const data = this.checkpointData.get(sessionId);
        if (!data) return;
        if (Number(newVal) > Number(prevVal || 0)) {
          data.cpHitSeq = this._cpHitSeq++;
        }
      });
    };

    this.callbacks.onAdd("players", (playerState, sessionId) => {
      handlePlayerAdded(playerState, sessionId, { allowReplace: true });
    });

    this.callbacks.onRemove("players", (_playerState, sessionId) => {
      const p = this.players.get(sessionId);
      if (p) {
        p.destroy();
        this.players.delete(sessionId);
      }

      this.checkpointData.delete(sessionId);

      if (this.localPlayer?.sessionId === sessionId) {
        this.localPlayer = null;
        this.cameras.main.stopFollow();
      }
    });

    // --- State bindings (powerups) ---
    const handlePowerUpAdded = (puState, puId, { allowReplace } = { allowReplace: true }) => {
      const existing = this.powerUps.get(puId);
      if (existing) {
        if (!allowReplace) return;
        try {
          existing.destroy?.();
        } catch (_) {}
        this.powerUps.delete(puId);
      }

      const view = this.createPowerUpView(puState);
      if (!view) return;

      view.syncFromState(puState);
      this.powerUps.set(puId, view);

      const puRefresh = (changes) => view.applyStateChanges(changes, puState);

      registerStatePropertyListeners(
        this.callbacks,
        puState,
        puRefresh,
        {
          type: (type) => {
            if (typeof view.setGunType === "function") view.setGunType(type);
          },
          active: (active) => view.setActive(!!active),
          x: (x) => view.setPosition(Number(x) || 0, view.sprite?.y ?? 0),
          y: (y) => view.setPosition(view.sprite?.x ?? 0, Number(y) || 0),
        }
      );
    };

    this.callbacks.onAdd("powerUps", (puState, puId) => {
      handlePowerUpAdded(puState, puId, { allowReplace: true });
    });

    this.callbacks.onRemove("powerUps", (_puState, puId) => {
      const view = this.powerUps.get(puId);
      if (view) view.destroy();
      this.powerUps.delete(puId);
    });

    // --- Events ---
    this.room.onMessage("shot", (msg) => {
      if (!this.visibility.canPlay()) return;
      spawnBeam(this, msg);
    });

    this.room.onMessage("sound", (msg) => {
      if (!this.visibility.canPlay()) return;

      const key = extractMessageProperty(msg, "k", "key");
      if (!key) return;
      if (!this.cache.audio.exists(key)) return;

      const volume = Math.max(0, Math.min(1, Number(extractMessageProperty(msg, "v", "volume", 1))));
      const rate = Math.max(0.01, Number(extractMessageProperty(msg, "r", "rate", 1)));

      this.sound.play(key, { volume, rate });
    });

    this.room.onMessage("kill", (msg) => {
      this._pendingKillEvents.push(msg);
    });

    // ✅ Round over: a player reached the finish line.
    // Keep the room open and transition through InterimScene, then back here.
    this.room.onMessage("roundOver", (msg) => {
      const winnerName = String(msg?.winnerName || "Player");
      const scores = Array.isArray(msg?.scores) ? msg.scores : [];
      const gameOver = !!msg?.gameOver;
      const winnerId = msg?.winnerId || null;

      // Stop sending inputs
      this.dragActive = false;

      // Don't leave the room when this scene shuts down
      this._keepRoom = true;

      const roomRef = this.room;
      const clientRef = this.client;
      const username = this._username;
      const playerCount = this.players.size;
      const skinId = this._skinId;

      this._fadeOutGameMusic(() => {
        this.scene.start("InterimScene", {
          room: roomRef,
          client: clientRef,
          username,
          playerCount,
          scores,
          winnerName,
          winnerId,
          isRoundOver: true,
          gameOver,
          skinId,
        });
      });
    });

    // ✅ If we joined the room earlier (in MatchmakingScene), the state may already contain
    // players/powerups before these callbacks were attached. Bootstrap anything we don't have yet.
    try {
      const st = this.room?.state;
      const players = st?.players;
      const powerUps = st?.powerUps;

      if (players && typeof players.forEach === "function") {
        players.forEach((playerState, sessionId) => {
          handlePlayerAdded(playerState, sessionId, { allowReplace: false });
        });
      }

      if (powerUps && typeof powerUps.forEach === "function") {
        powerUps.forEach((puState, puId) => {
          handlePowerUpAdded(puState, puId, { allowReplace: false });
        });
      }
    } catch (e) {
      console.warn("Failed to bootstrap existing room state:", e);
    }
  }

  _removeCoverOverlay(onDone) {
    if (!this._coverOverlay) {
      if (onDone) onDone();
      return;
    }
    const cover = this._coverOverlay;
    this._coverOverlay = null;
    const H = this.scale.height;
    this.tweens.add({
      targets: cover,
      y: H,
      duration: COVER_SLIDE_OUT_MS,
      ease: "Power2",
      onComplete: () => {
        try { cover.destroy(); } catch (_) {}
        if (onDone) onDone();
      },
    });
  }

  // create an image at each Tiled point in "PlayerSpawnPoints" (no collision)
  spawnCheckpointMarkers() {
    for (const s of this.checkpointSprites) {
      try {
        s.destroy();
      } catch (_) {}
    }
    this.checkpointSprites = [];

    const tilemap = this.map?.map;
    if (!tilemap || typeof tilemap.getObjectLayer !== "function") return;

    const layer = tilemap.getObjectLayer("PlayerSpawnPoints");
    const objs = Array.isArray(layer?.objects) ? layer.objects : [];

    for (const o of objs) {
      const x = Number(o?.x);
      const y = Number(o?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const img = this.add.image(x, y + 232, "checkpoint");
      img.setOrigin(0.5, 1);
      img.setDepth(1);

      this.checkpointSprites.push(img);
    }
  }

  applyCameraTuning() {
    const cam = this.cameras.main;

    cam.setZoom(CAMERA_ZOOM);
    cam.setRoundPixels(!!CAMERA_ROUND_PIXELS);

    const ax = Phaser.Math.Clamp(CAMERA_DEADZONE_ANCHOR_X, 0, 1);
    const ay = Phaser.Math.Clamp(CAMERA_DEADZONE_ANCHOR_Y, 0, 1);

    cam.setDeadzone(CAMERA_DEADZONE_W_PX, CAMERA_DEADZONE_H_PX);
    cam.setFollowOffset(
      (ax - 0.5) * CAMERA_DEADZONE_W_PX,
      (ay - 0.5) * CAMERA_DEADZONE_H_PX
    );
  }

  // Returns players sorted by checkpoint progress for the leaderboard.
  // Reads cpOrder from the server-synced PlayerState (authoritative).
  getRankedPlayers() {
    const entries = [];

    const players = this.room?.state?.players;
    if (!players || typeof players.forEach !== "function") return entries;

    players.forEach((st, sid) => {
      const player = this.players.get(sid);
      const name = player?.name || String(st?.name || "Player");
      const cpOrder = Number(st?.cpOrder) || 0;
      const data = this.checkpointData.get(sid);
      const cpHitSeq = data?.cpHitSeq ?? Infinity;
      const joinOrder = data?.joinOrder ?? 9999;
      entries.push({ sid, name, order: cpOrder, cpHitSeq, joinOrder });
    });

    // Primary: highest checkpoint order first.
    // Tie-break (same checkpoint): whoever hit that checkpoint first (lower cpHitSeq).
    // Final fallback: whoever joined the room first (lower joinOrder).
    entries.sort((a, b) => {
      if (a.order !== b.order) return b.order - a.order;
      if (a.cpHitSeq !== b.cpHitSeq) return a.cpHitSeq - b.cpHitSeq;
      return a.joinOrder - b.joinOrder;
    });

    return entries;
  }

  createPowerUpView(puState) {
    const type = puState?.type;

    if (type) {
      try {
        return new GunPowerUp({ scene: this, gunId: type, x: puState.x, y: puState.y });
      } catch (_) {}
    }

    return null;
  }

  _fadeOutGameMusic(onDone, duration = 500) {
    if (!this._gameMusic?.isPlaying) { onDone?.(); return; }
    this.tweens.add({
      targets: this._gameMusic,
      volume: 0,
      duration,
      onComplete: () => {
        try { this._gameMusic?.stop(); } catch (_) {}
        onDone?.();
      },
    });
  }

  registerCleanup() {
    if (this._cleanupRegistered) return;
    this._cleanupRegistered = true;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  cleanup() {
    try {
      this.visibility?.destroy();
    } catch (_) {}
    this.visibility = null;

    if (this.scale) this.scale.off("resize");

    try {
      this.input?.off("pointerdown");
      this.input?.off("pointermove");
      this.input?.off("pointerup");
      this.input?.off("pointerupoutside");
    } catch (_) {}

    try {
      this.room?.removeAllListeners();
    } catch (_) {}

    try {
      this.callbacks?.removeAllListeners?.();
    } catch (_) {}

    try {
      this.cameras?.main?.stopFollow();
    } catch (_) {}

    destroyAllInCollection(this.players);
    this.localPlayer = null;

    destroyAllInCollection(this.powerUps);

    for (const s of this.checkpointSprites) {
      try {
        s.destroy();
      } catch (_) {}
    }
    this.checkpointSprites = [];

    this.checkpointData.clear();
    this._joinSeq = 0;
    this._cpHitSeq = 0;

    try { this._coverOverlay?.destroy(); } catch (_) {}
    this._coverOverlay = null;

    // Stop game music (fade should have already stopped it; this is a safety net)
    try { this._gameMusic?.stop(); } catch (_) {}
    this._gameMusic = null;

    // Stop the HUD overlay so it doesn't bleed over InterimScene (or any
    // other scene that follows).  ensureUIScene() will relaunch it when
    // GameScene next becomes active.
    try {
      if (this.scene.isActive("UIScene")) {
        this.scene.stop("UIScene");
      }
    } catch (_) {}

    try {
      if (!this._keepRoom) {
        this.room?.leave();
      }
    } catch (_) {}
    this.room = null;

    this.client = null;
    this.callbacks = null;

    this._reservation = null;
    this._clientFromMM = null;
    this._roomFromMM = null;
    this._keepRoom = false;
  }

  sendInput(deltaSec) {
    if (!this.room) return;

    this.netAcc += deltaSec;
    const step = 1 / NET_SEND_HZ;
    if (this.netAcc < step) return;
    this.netAcc = 0;

    const localDead = !!this.localPlayer?.isDead;
    if (localDead) this.dragActive = false;

    const tiltLeft = localDead ? false : !!this.keyTiltLeft?.isDown;
    const tiltRight = localDead ? false : !!this.keyTiltRight?.isDown;

    const fireHeld = localDead ? false : !!this.keyFire?.isDown;
    const firePressed = localDead ? false : Phaser.Input.Keyboard.JustDown(this.keyFire);
    if (firePressed) this.fireSeq = (this.fireSeq + 1) | 0;

    // b is a compact bitmask:
    // 1 = tiltLeft, 2 = tiltRight, 4 = dragActive, 8 = fireHeld
    const b =
      (tiltLeft ? 1 : 0) |
      (tiltRight ? 2 : 0) |
      (this.dragActive ? 4 : 0) |
      (fireHeld ? 8 : 0);

    const payload = { b, f: this.fireSeq };
    if (this.dragActive) {
      payload.x = this.dragX;
      payload.y = this.dragY;
    }

    const last = this.lastSent;
    const same =
      last &&
      last.b === payload.b &&
      last.f === payload.f &&
      (last.x ?? null) === (payload.x ?? null) &&
      (last.y ?? null) === (payload.y ?? null);

    if (!same) {
      this.room.send("input", payload);
      this.lastSent = payload;
    }
  }

  update(_time, deltaMs) {
    const dt = Math.min(0.05, (deltaMs || 0) / 1000);

    for (const p of this.players.values()) {
      p.update(dt);
    }

    this.sendInput(dt);
  }
}