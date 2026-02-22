// ============================================================
// src/GameScene.js
// CLIENT: render-only.
// - Server runs physics/collisions.
// - Client renders sprites, VFX, and plays audio.
// - Client sends compact inputs.
//
// ✅ Adds checkpoint markers (no collision) at Tiled "PlayerSpawnPoints"
//    using image: assets/images/checkpoint.png (key: "checkpoint")
// ============================================================

import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import { Callbacks } from "@colyseus/schema";

import GameMap from "./GameMap.js";
import Player from "./player.js";
import GunPowerUp from "./GunPowerUp.js";
import SniperGunPowerUp from "./SniperGunPowerUp.js";
import { preloadGuns } from "./gunCatalog.js";

// ✅ connects to same host (works on LAN)
const COLYSEUS_URL = `${window.location.protocol}//${window.location.hostname}:2567`;
const ROOM_NAME = "lobby";

export const NET_SEND_HZ = 60;

// ------------------------------------------------------------
// Camera tuning
// ------------------------------------------------------------
const CAMERA_ZOOM = 0.7;

const CAMERA_FOLLOW_LERP_X = 1;
const CAMERA_FOLLOW_LERP_Y = 1;

const CAMERA_DEADZONE_W_PX = 420;
const CAMERA_DEADZONE_H_PX = 260;

const CAMERA_DEADZONE_ANCHOR_X = 0.5;
const CAMERA_DEADZONE_ANCHOR_Y = 0.55;

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

function spawnBeam(scene, msg) {
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

    this.map = null;

    this.players = new Map();
    this.localPlayer = null;

    this.powerUps = new Map();

    // ✅ checkpoint marker sprites (no collision)
    this.checkpointSprites = [];

    this.dragActive = false;
    this.dragX = 0;
    this.dragY = 0;
    this.fireSeq = 0;

    this.netAcc = 0;
    this.lastSent = null;

    this.statusText = null;
    this.callbacks = null;

    this._cleanupRegistered = false;
  }

  preload() {
    this.load.image("player", "assets/images/player.png");
    this.load.image("arm", "assets/images/arm.png");

    // ✅ checkpoint marker image
    this.load.image("checkpoint", "assets/images/checkpoint.png");

    GameMap.preload(this);
    preloadGuns(this);

    this.load.on("loaderror", (file) => {
      console.error("Asset failed to load:", file?.key, file?.src);
    });
  }

  async create() {
    this.map = new GameMap(this).create();

    // ✅ spawn checkpoint marker images at Tiled respawn points
    this.spawnCheckpointMarkers();

    this.statusText = this.add
      .text(20, 20, "Connecting...", { fontSize: "18px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(2000);

    this.keyTiltLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyTiltRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyFire = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Drag input
    this.input.on("pointerdown", (pointer) => {
      if (!this.localPlayer?.sprite) return;

      // ✅ If dead/ragdolling, no dragging
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

      // ✅ If we died mid-drag, stop dragging immediately
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

    // Connect
    try {
      this.client = new Client(COLYSEUS_URL);
      this.room = await this.client.joinOrCreate(ROOM_NAME);

      // ✅ IMPORTANT: Callbacks is NOT constructed with `new` in your project
      this.callbacks = Callbacks.get(this.room);

      this.statusText.setText(`Connected: ${COLYSEUS_URL}`);

      this.registerCleanup();
    } catch (e) {
      console.error("Failed to connect to Colyseus:", e);
      this.statusText.setText(`Server offline at ${COLYSEUS_URL}`);
      return;
    }

    // Resize hook
    this.scale.on("resize", () => this.applyCameraTuning());

    // --- State bindings (players) ---
    this.callbacks.onAdd("players", (playerState, sessionId) => {
      const isLocal = sessionId === this.room.sessionId;

      // ✅ prevent duplicate sprites (ghost look)
      const existing = this.players.get(sessionId);
      if (existing) {
        existing.destroy();
        this.players.delete(sessionId);
      }

      const p = new Player({ scene: this, sessionId, isLocal });
      this.players.set(sessionId, p);

      p.setTargetFromState(playerState);

      if (isLocal) {
        this.localPlayer = p;

        // ✅ follow the ACTUAL player sprite (no custom follow-point)
        this.cameras.main.startFollow(
          p.sprite,
          CAMERA_ROUND_PIXELS,
          CAMERA_FOLLOW_LERP_X,
          CAMERA_FOLLOW_LERP_Y
        );

        this.applyCameraTuning();
      }

      if (playerState && Object.prototype.hasOwnProperty.call(playerState, "onChange")) {
        playerState.onChange = (changes) => {
          if (typeof p.applyStateChanges === "function") p.applyStateChanges(changes, playerState);
          else p.setTargetFromState(playerState);
        };
      } else {
        const refresh = () => p.setTargetFromState(playerState);

        // ✅ include "dead" in the listened fields
        [
          "x","y","a",
          "armX","armY","armA",
          "dir",
          "gunId","ammo",
          "maxHealth","health",
          "dead",
          "gunX","gunY","gunA"
        ].forEach((k) => {
          this.callbacks.listen(playerState, k, refresh);
        });
      }
    });

    this.callbacks.onRemove("players", (_playerState, sessionId) => {
      const p = this.players.get(sessionId);
      if (p) {
        p.destroy();
        this.players.delete(sessionId);
      }

      if (this.localPlayer?.sessionId === sessionId) {
        this.localPlayer = null;
        this.cameras.main.stopFollow();
      }
    });

    // --- State bindings (powerups) ---
    this.callbacks.onAdd("powerUps", (puState, puId) => {
      const existing = this.powerUps.get(puId);
      if (existing) {
        try { existing.destroy?.(); } catch (_) {}
        this.powerUps.delete(puId);
      }

      const view = this.createPowerUpView(puState);
      if (!view) return;

      view.syncFromState(puState);
      this.powerUps.set(puId, view);

      if (puState && Object.prototype.hasOwnProperty.call(puState, "onChange")) {
        puState.onChange = (changes) => view.applyStateChanges(changes, puState);
      } else {
        this.callbacks.listen(puState, "active", (active) => view.setActive(!!active));
        this.callbacks.listen(puState, "x", (x) => view.setPosition(Number(x) || 0, view.sprite?.y ?? 0));
        this.callbacks.listen(puState, "y", (y) => view.setPosition(view.sprite?.x ?? 0, Number(y) || 0));
      }
    });

    this.callbacks.onRemove("powerUps", (_puState, puId) => {
      const view = this.powerUps.get(puId);
      if (view) view.destroy();
      this.powerUps.delete(puId);
    });

    // --- Events ---
    this.room.onMessage("shot", (msg) => spawnBeam(this, msg));

    this.room.onMessage("sound", (msg) => {
      const key = msg?.k ?? msg?.key;
      if (!key) return;
      if (!this.cache.audio.exists(key)) return;

      const volume = Math.max(0, Math.min(1, Number(msg?.v ?? msg?.volume ?? 1)));
      const rate = Math.max(0.01, Number(msg?.r ?? msg?.rate ?? 1));

      this.sound.play(key, { volume, rate });
    });
  }

  // ✅ Simple: create an image at each Tiled point in "PlayerSpawnPoints"
  // No physics body is created => no collision.
  spawnCheckpointMarkers() {
    // clear old markers if scene restarts
    for (const s of this.checkpointSprites) {
      try { s.destroy(); } catch (_) {}
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

      const img = this.add.image(x, y+232, "checkpoint");

      // Usually you want the bottom of the sprite to sit on the point
      img.setOrigin(0.5, 1);

      // Put behind players
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

    const offX = (0.5 - ax) * cam.width;
    const offY = (0.5 - ay) * cam.height;
    cam.setFollowOffset(offX, offY);

    cam.setDeadzone(CAMERA_DEADZONE_W_PX, CAMERA_DEADZONE_H_PX);

    if (cam.deadzone) {
      cam.deadzone.x = cam.width * ax - CAMERA_DEADZONE_W_PX / 2;
      cam.deadzone.y = cam.height * ay - CAMERA_DEADZONE_H_PX / 2;
    }
  }

  createPowerUpView(puState) {
    const type = String(puState?.type || "");
    if (type === "sniper") return new SniperGunPowerUp({ scene: this, x: puState.x, y: puState.y });
    if (type) return new GunPowerUp({ scene: this, gunId: type, x: puState.x, y: puState.y });
    return null;
  }

  registerCleanup() {
    if (this._cleanupRegistered) return;
    this._cleanupRegistered = true;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
  }

  cleanup() {
    try { this.cameras?.main?.stopFollow(); } catch (_) {}

    for (const p of this.players.values()) {
      try { p.destroy(); } catch (_) {}
    }
    this.players.clear();
    this.localPlayer = null;

    for (const v of this.powerUps.values()) {
      try { v.destroy?.(); } catch (_) {}
    }
    this.powerUps.clear();

    // ✅ destroy checkpoint markers
    for (const s of this.checkpointSprites) {
      try { s.destroy(); } catch (_) {}
    }
    this.checkpointSprites = [];

    try { this.room?.leave(); } catch (_) {}
    this.room = null;
    this.client = null;
    this.callbacks = null;
  }

  sendInput(deltaSec) {
    if (!this.room) return;

    this.netAcc += deltaSec;
    const step = 1 / NET_SEND_HZ;
    if (this.netAcc < step) return;
    this.netAcc = 0;

    // ✅ dead players can't control anything
    const localDead = !!this.localPlayer?.isDead;

    // if dead, cancel dragging
    if (localDead) this.dragActive = false;

    const tiltLeft = localDead ? false : !!this.keyTiltLeft?.isDown;
    const tiltRight = localDead ? false : !!this.keyTiltRight?.isDown;

    const firePressed = localDead ? false : Phaser.Input.Keyboard.JustDown(this.keyFire);
    if (firePressed) this.fireSeq = (this.fireSeq + 1) | 0;

    const b =
      (tiltLeft ? 1 : 0) |
      (tiltRight ? 2 : 0) |
      (this.dragActive ? 4 : 0);

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
