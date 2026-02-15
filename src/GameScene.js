// ============================================================
// src/GameScene.js
// CLIENT: server-authoritative rendering + input sending.
// Uses Player render-only (guns restored like before).
// ============================================================

import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";

import GameMap from "./GameMap.js";
import Player from "./player.js";
import { GUN_CATALOG, preloadGuns } from "./gunCatalog.js";

// ✅ connects to same host (works on LAN)
const COLYSEUS_URL = `${window.location.protocol}//${window.location.hostname}:2567`;
const ROOM_NAME = "lobby";

// ✅ outgoing input rate
export const NET_SEND_HZ = 60;

// For your drag grab
const MOUSE_GRAB_RADIUS_PX = 140;

// beam helper (same as before)
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
  const sx = Number(msg.sx) || 0;
  const sy = Number(msg.sy) || 0;
  const ex = Number(msg.ex) || 0;
  const ey = Number(msg.ey) || 0;

  const widthPx = Math.max(1, Number(msg.widthPx ?? 10));
  const lifeSec = Math.max(0.01, Number(msg.lifeSec ?? 0.05));
  const tailLenPx = Math.max(10, Number(msg.tailLenPx ?? 200));
  const color = Number(msg.color ?? 0xffffff);

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
    this.callbacks = null;

    this.map = null;

    this.players = new Map();
    this.localPlayer = null;

    this.powerUpSprites = new Map();

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

    this.keyTiltLeft = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyTiltRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.keyFire = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Drag input
    this.input.on("pointerdown", (pointer) => {
      if (!this.localPlayer) return;

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
      this.callbacks = Callbacks.get(this.room);
      this.statusText.setText(`Connected: ${COLYSEUS_URL}`);
    } catch (e) {
      console.error("Failed to connect to Colyseus:", e);
      this.statusText.setText(`Server offline at ${COLYSEUS_URL}`);
      return;
    }

    // Players
    this.callbacks.onAdd("players", (playerState, sessionId) => {
      const isLocal = sessionId === this.room.sessionId;

      const p = new Player({ scene: this, sessionId, isLocal });
      this.players.set(sessionId, p);

      // initial
      p.setTargetFromState(playerState);

      if (isLocal) {
        this.localPlayer = p;
        this.cameras.main.startFollow(p.sprite, true, 0.15, 0.15);
      }

      const refresh = () => p.setTargetFromState(playerState);
      ["x","y","a","armX","armY","armA","dir","gunId","ammo"].forEach((k) => {
        this.callbacks.listen(playerState, k, refresh);
      });
    });

    this.callbacks.onRemove("players", (_playerState, sessionId) => {
      const p = this.players.get(sessionId);
      if (p) {
        p.destroy();
        this.players.delete(sessionId);
      }
      if (this.localPlayer?.sessionId === sessionId) this.localPlayer = null;
    });

    // Powerups
    this.callbacks.onAdd("powerUps", (puState, puId) => {
      const def = GUN_CATALOG[puState.type];
      if (!def) return;

      const spr = this.add.sprite(puState.x, puState.y, def.pickupKey);
      spr.setDisplaySize(def.pickupWpx, def.pickupHpx);
      spr.setDepth(2);

      spr.setVisible(!!puState.active);
      this.powerUpSprites.set(puId, spr);

      this.callbacks.listen(puState, "active", (active) => spr.setVisible(!!active));
      this.callbacks.listen(puState, "x", (x) => (spr.x = Number(x) || 0));
      this.callbacks.listen(puState, "y", (y) => (spr.y = Number(y) || 0));
    });

    this.callbacks.onRemove("powerUps", (_puState, puId) => {
      const spr = this.powerUpSprites.get(puId);
      if (spr) spr.destroy();
      this.powerUpSprites.delete(puId);
    });

    // Events (server authoritative)
    this.room.onMessage("shot", (msg) => spawnBeam(this, msg));

    this.room.onMessage("sound", (msg) => {
      const key = msg?.key;
      if (!key) return;
      if (!this.cache.audio.exists(key)) return;

      const volume = Math.max(0, Math.min(1, Number(msg.volume ?? 1)));
      const rate = Math.max(0.01, Number(msg.rate ?? 1));
      this.sound.play(key, { volume, rate });
    });
  }

  buildInputPayload() {
    return {
      tiltLeft: this.keyTiltLeft?.isDown || false,
      tiltRight: this.keyTiltRight?.isDown || false,

      dragActive: this.dragActive,
      dragX: this.dragX,
      dragY: this.dragY,

      fireSeq: this.fireSeq,
    };
  }

  update(_time, deltaMs) {
    const dt = deltaMs / 1000;

    for (const p of this.players.values()) p.update(dt);

    if (this.keyFire && Phaser.Input.Keyboard.JustDown(this.keyFire)) {
      this.fireSeq = (this.fireSeq + 1) | 0;
    }

    if (!this.room) return;

    this.netAcc += dt;
    const step = 1 / NET_SEND_HZ;

    while (this.netAcc >= step) {
      this.netAcc -= step;

      const payload = this.buildInputPayload();

      // tiny bandwidth saver
      const same =
        this.lastSent &&
        this.lastSent.tiltLeft === payload.tiltLeft &&
        this.lastSent.tiltRight === payload.tiltRight &&
        this.lastSent.dragActive === payload.dragActive &&
        this.lastSent.fireSeq === payload.fireSeq &&
        (!payload.dragActive ||
          (Math.abs(this.lastSent.dragX - payload.dragX) < 0.5 &&
            Math.abs(this.lastSent.dragY - payload.dragY) < 0.5));

      if (!same) {
        this.room.send("input", payload);
        this.lastSent = payload;
      }
    }
  }
}
