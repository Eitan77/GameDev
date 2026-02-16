// ============================================================
// src/GameScene.js
// CLIENT: render-only.
// - Server runs physics/collisions.
// - Client renders sprites, VFX, and plays audio.
// - Client sends compact inputs.
//
// Efficiency changes vs the old version:
// - Uses Colyseus Schema callbacks directly (no per-field "listen" fanout).
// - Compact network messages for input/sound/shot.
// ============================================================

import Phaser from "phaser";
import { Client } from "@colyseus/sdk";

import GameMap from "./GameMap.js";
import Player from "./player.js";
import GunPowerUp from "./GunPowerUp.js";
import SniperGunPowerUp from "./SniperGunPowerUp.js";
import { preloadGuns } from "./gunCatalog.js";

// ✅ connects to same host (works on LAN)
const COLYSEUS_URL = `${window.location.protocol}//${window.location.hostname}:2567`;
const ROOM_NAME = "lobby";

// outgoing input rate (note: we still only send on change)
export const NET_SEND_HZ = 60;

// For your drag grab
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

function spawnBeam(scene, msg) {
  // Supports both old verbose keys and new compact keys.
  const sx = Number(msg?.sx) || 0;
  const sy = Number(msg?.sy) || 0;
  const ex = Number(msg?.ex) || 0;
  const ey = Number(msg?.ey) || 0;

  const widthPx = Math.max(1, Number(msg?.w ?? msg?.widthPx ?? 10));
  const lifeSec = Math.max(0.01, Number(msg?.l ?? msg?.lifeSec ?? 0.05));
  const tailLenPx = Math.max(10, Number(msg?.t ?? msg?.tailLenPx ?? 200));
  const color = Number(msg?.c ?? msg?.color ?? 0xffffff);

  const len = Phaser.Math.Distance.Between(sx, sy, ex, ey);
  if (len < 2) return;

  const ang = Math.atan2(ey - sy, ex - sx);
  const whiteKey = ensureWhitePixelTexture(scene);

  const beamImg = scene.add.image(sx, sy, whiteKey);
  beamImg.setOrigin(0, 0.5);
  beamImg.setDisplaySize(len, widthPx);
  beamImg.setTint(color);
  beamImg.rotation = ang;
  beamImg.setDepth(999);

  const maskKey = `beam_mask_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const maskTex = scene.textures.createCanvas(maskKey, Math.max(2, Math.ceil(len)), Math.max(2, Math.ceil(widthPx)));

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

    this.map = null;

    this.players = new Map();   // sessionId -> Player(view)
    this.localPlayer = null;

    this.powerUps = new Map();  // powerUpId -> PowerUp(view)

    // Input state
    this.dragActive = false;
    this.dragX = 0;
    this.dragY = 0;
    this.fireSeq = 0;

    this.netAcc = 0;
    this.lastSent = null;

    this.statusText = null;
  }

  preload() {
    this.load.image("player", "assets/images/player.png");
    this.load.image("arm", "assets/images/arm.png");

    GameMap.preload(this);
    preloadGuns(this);

    this.load.on("loaderror", (file) => {
      console.error("Asset failed to load:", file?.key, file?.src);
    });
  }

  async create() {
    this.map = new GameMap(this).create();

    this.statusText = this.add
      .text(20, 20, "Connecting...", { fontSize: "18px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(2000);

    // Keys
    this.keyTiltLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyTiltRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyFire = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Drag input (render-only client; server applies the joint)
    this.input.on("pointerdown", (pointer) => {
      if (!this.localPlayer?.sprite) return;

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
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.dragX = wp.x;
      this.dragY = wp.y;
    });

    const endDrag = () => (this.dragActive = false);
    this.input.on("pointerup", endDrag);
    this.input.on("pointerupoutside", endDrag);

    // Connect
    try {
      this.client = new Client(COLYSEUS_URL);
      this.room = await this.client.joinOrCreate(ROOM_NAME);
      this.statusText.setText(`Connected: ${COLYSEUS_URL}`);
    } catch (e) {
      console.error("Failed to connect to Colyseus:", e);
      this.statusText.setText(`Server offline at ${COLYSEUS_URL}`);
      return;
    }

    // --- State bindings (players) ---
    const players = this.room.state.players;
    players.onAdd = (playerState, sessionId) => {
      const isLocal = sessionId === this.room.sessionId;

      const p = new Player({ scene: this, sessionId, isLocal });
      this.players.set(sessionId, p);
      p.setTargetFromState(playerState);

      if (isLocal) {
        this.localPlayer = p;
        this.cameras.main.startFollow(p.sprite, true, 0.15, 0.15);
      }

      // One callback per player state (instead of per-field listeners)
      playerState.onChange = (changes) => {
        p.applyStateChanges(changes, playerState);
      };
    };

    players.onRemove = (_playerState, sessionId) => {
      const p = this.players.get(sessionId);
      if (p) {
        p.destroy();
        this.players.delete(sessionId);
      }
      if (this.localPlayer?.sessionId === sessionId) this.localPlayer = null;
    };

    // Trigger onAdd for any entries that already exist in the initial state.
    players.forEach((playerState, sessionId) => players.onAdd?.(playerState, sessionId));

    // --- State bindings (powerups) ---
    const powerUps = this.room.state.powerUps;
    powerUps.onAdd = (puState, puId) => {
      const view = this.createPowerUpView(puState);
      if (!view) return;

      view.syncFromState(puState);
      this.powerUps.set(puId, view);

      puState.onChange = (changes) => {
        view.applyStateChanges(changes, puState);
      };
    };

    powerUps.onRemove = (_puState, puId) => {
      const view = this.powerUps.get(puId);
      if (view) view.destroy();
      this.powerUps.delete(puId);
    };

    powerUps.forEach((puState, puId) => powerUps.onAdd?.(puState, puId));

    // --- Events (server authoritative) ---
    this.room.onMessage("shot", (msg) => spawnBeam(this, msg));

    this.room.onMessage("sound", (msg) => {
      // Supports both old keys and new compact keys.
      const key = msg?.k ?? msg?.key;
      if (!key) return;
      if (!this.cache.audio.exists(key)) return;

      const volume = Math.max(0, Math.min(1, Number(msg?.v ?? msg?.volume ?? 1)));
      const rate = Math.max(0.01, Number(msg?.r ?? msg?.rate ?? 1));

      // One-shot play locally.
      this.sound.play(key, { volume, rate });
    });
  }

  createPowerUpView(puState) {
    const type = String(puState?.type || "");
    if (!type) return null;

    // If you add more guns later, either add a subclass per gun,
    // OR just let GunPowerUp handle it via gunCatalog.
    if (type === "sniper") {
      return new SniperGunPowerUp({ scene: this, x: Number(puState.x) || 0, y: Number(puState.y) || 0 });
    }

    try {
      return new GunPowerUp({ scene: this, gunId: type, x: Number(puState.x) || 0, y: Number(puState.y) || 0 });
    } catch (e) {
      console.warn("Unknown powerup type:", type, e);
      return null;
    }
  }

  // Compact input:
  //   b = bitmask: 1=tiltLeft, 2=tiltRight, 4=dragActive
  //   f = fireSeq
  //   x/y only present when dragActive
  buildInputPayloadCompact() {
    const tiltLeft = this.keyTiltLeft?.isDown || false;
    const tiltRight = this.keyTiltRight?.isDown || false;

    const b = (tiltLeft ? 1 : 0) | (tiltRight ? 2 : 0) | (this.dragActive ? 4 : 0);
    const msg = { b, f: this.fireSeq | 0 };

    if (this.dragActive) {
      // Quantize to ints to reduce payload churn.
      msg.x = Math.round(this.dragX);
      msg.y = Math.round(this.dragY);
    }

    return msg;
  }

  update(_time, deltaMs) {
    const dt = deltaMs / 1000;

    // Render updates
    for (const p of this.players.values()) p.update(dt);

    // Fire input
    if (this.keyFire && Phaser.Input.Keyboard.JustDown(this.keyFire)) {
      this.fireSeq = (this.fireSeq + 1) | 0;
    }

    if (!this.room) return;

    // Input send loop
    this.netAcc += dt;
    const step = 1 / NET_SEND_HZ;

    while (this.netAcc >= step) {
      this.netAcc -= step;

      const msg = this.buildInputPayloadCompact();

      const same =
        this.lastSent &&
        this.lastSent.b === msg.b &&
        this.lastSent.f === msg.f &&
        (msg.b & 4
          ? this.lastSent.x === msg.x && this.lastSent.y === msg.y
          : true);

      if (!same) {
        this.room.send("input", msg);
        this.lastSent = msg;
      }
    }
  }
}
