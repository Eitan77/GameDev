// ============================================================
// GameScene.js (FULL FILE)
// - Uses @colyseus/sdk (v0.17 client) ✅
// - Uses Callbacks.get(room) for onAdd/onRemove/listen ✅
// - Spawns Player objects from server state
// - Sends local pose to server ~15x/sec
// ============================================================

import Phaser from "phaser";
import planck from "planck";
import { Client, Callbacks } from "@colyseus/sdk";

import Player from "./player.js";
import GameMap from "./GameMap.js";

const pl = planck;
const Vec2 = pl.Vec2;

// -------------------- COLYSEUS --------------------
const COLYSEUS_ENDPOINT = "http://192.168.68.54:2567"; // IMPORTANT: http (SDK handles ws internally)
const ROOM_NAME = "lobby";

// -------------------- TILED NAMES (must match Tiled editor) --------------------
const TILESET_NAME_IN_TILED = "ground_tile";
const TILE_LAYER_NAME = "Tile Layer 1";

// -------------------- CONSTANTS --------------------
const PPM = 30;
const FIXED_DT = 1 / 60;

const GRAVITY_X = 0;
const GRAVITY_Y = 40;

const CAMERA_VIEW_W_PX = 1500;
const CAMERA_VIEW_H_PX = 1000;

const CAMERA_START_FOLLOW = true;
const CAMERA_FOLLOW_LERP_X = 1.0;
const CAMERA_FOLLOW_LERP_Y = 1.0;

const CAMERA_DEADZONE_W_PX = 300;
const CAMERA_DEADZONE_H_PX = 80;

const CAMERA_ROUND_PIXELS = true;

const CAMERA_MANUAL_SPEED_PX_PER_SEC = 1200;
const CAMERA_TOGGLE_KEY = "F";
const CAMERA_BOUNDS_PAD_Y_PX = 300;

// -------------------- ASSETS --------------------
const ARM_IMAGE_KEY = "arm";
const ARM_IMAGE_PATH = "assets/images/arm.png";

const MAP_KEY = "level1";
const TILESET_IMAGE_KEY = "groundTiles";
const BG_KEY = "bg";

export default class GameScene extends Phaser.Scene {
  preload() {
    // Log load errors (super useful when paths are wrong)
    this.load.on("loaderror", (file) => {
      console.error("LOAD ERROR:", file.key, file.src);
    });

    // Map + tiles + images
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/level1.tmj");
    this.load.image(TILESET_IMAGE_KEY, "assets/tiles/ground_tile.png");
    this.load.image(BG_KEY, "assets/images/level1_bg.png");

    // Player visuals
    this.load.image("player", "assets/images/player.png");
    this.load.image(ARM_IMAGE_KEY, ARM_IMAGE_PATH);
  }

  create() {
    // -------------------- INPUT --------------------
    this.keys = this.input.keyboard.addKeys({
      tiltLeft: "W",
      tiltRight: "E",
    });

    this.camKeys = this.input.keyboard.addKeys({
      left: "LEFT",
      right: "RIGHT",
      up: "UP",
      down: "DOWN",
      toggle: CAMERA_TOGGLE_KEY,
    });

    // -------------------- PHYSICS WORLD --------------------
    this.world = new pl.World(Vec2(GRAVITY_X, GRAVITY_Y));

    // -------------------- MAP (visual + colliders) --------------------
    this.gameMap = new GameMap({
      scene: this,
      world: this.world,
      ppm: PPM,

      mapKey: MAP_KEY,

      tilesetNameInTiled: TILESET_NAME_IN_TILED,
      tilesetImageKey: TILESET_IMAGE_KEY,
      layerName: TILE_LAYER_NAME,

      bgKey: BG_KEY,

      groundFriction: 0.8,
      collideWithAnyNonEmptyTile: true,

      wallsEnabled: true,
      wallThicknessPx: 40,
      wallFriction: 0.6,
    });

    this.gameMap.buildVisuals();
    this.gameMap.buildColliders();
    this.groundBody = this.gameMap.groundBody;

    // -------------------- CAMERA --------------------
    const cam = this.cameras.main;
    cam.roundPixels = CAMERA_ROUND_PIXELS;

    const zoomForWidth = cam.width / CAMERA_VIEW_W_PX;
    const zoomForHeight = cam.height / CAMERA_VIEW_H_PX;
    cam.setZoom(Math.max(zoomForWidth, zoomForHeight));

    this.camBounds = this.gameMap.getCameraBounds(CAMERA_BOUNDS_PAD_Y_PX);
    cam.setBounds(this.camBounds.x, this.camBounds.y, this.camBounds.w, this.camBounds.h);

    this.cameraFollowEnabled = CAMERA_START_FOLLOW;

    // -------------------- PLAYERS --------------------
    this.players = new Map(); // sessionId -> Player
    this.localSessionId = null;
    this.localPlayer = null;

    // For cleaning up callbacks per remote player
    this.netUnsubs = new Map(); // sessionId -> [unsubFn, unsubFn, ...]

    // -------------------- UI --------------------
    this.netText = this.add
      .text(12, 12, "Connecting...", { fontFamily: "monospace", fontSize: "16px" })
      .setScrollFactor(0)
      .setDepth(9999);

    // -------------------- MOUSE (forward to local player only) --------------------
    this.setupMouseControls();

    // -------------------- FIXED STEP --------------------
    this.acc = 0;

    // Send rate: ~15 times/sec
    this.netSendAcc = 0;
    this.netSendInterval = 1 / 15;

    // -------------------- CONNECT --------------------
    this.connectToColyseus();
  }

  // ==========================================================
  // COLYSEUS CONNECT (v0.17 SDK)
  // ==========================================================
  async connectToColyseus() {
    try {
      console.log("Connecting to Colyseus...", COLYSEUS_ENDPOINT, "room:", ROOM_NAME);

      // Create client (SDK uses HTTP for matchmaking; then upgrades to WS for the room)
      const client = new Client(COLYSEUS_ENDPOINT);

      // Join or create the room
      this.room = await client.joinOrCreate(ROOM_NAME);

      // Remember our session id
      this.localSessionId = this.room.sessionId;

      // Show connected info
      this.netText.setText(
        `Connected!\nroomId: ${this.room.id}\nsessionId: ${this.localSessionId}`
      );

      // Get the correct state callback handler (THIS replaces .onAdd/.onRemove directly)
      this.callbacks = Callbacks.get(this.room);

      // When a player is added to state.players
      this.callbacks.onAdd("players", (playerState, sessionId) => {
        this.spawnPlayerFromState(playerState, sessionId);
      });

      // When a player is removed from state.players
      this.callbacks.onRemove("players", (_playerState, sessionId) => {
        this.despawnPlayer(sessionId);
      });

      // Safety: if the room errors out, show it
      this.room.onError((code, message) => {
        console.error("Room error:", code, message);
        this.netText.setText(`Room error ${code}\n${message}`);
      });

    } catch (err) {
      console.error("Colyseus connect failed:", err);
      this.netText.setText("Connection failed (check console)");
    }
  }

  // ==========================================================
  // SPAWN / DESPAWN
  // ==========================================================
  spawnPlayerFromState(playerState, sessionId) {
    // Prevent duplicates (can happen if you refresh fast)
    if (this.players.has(sessionId)) return;

    const isLocal = sessionId === this.localSessionId;

    // Create the Player object (local sim or remote sim)
    const p = new Player({
      scene: this,
      world: this.world,
      groundBody: this.groundBody,
      ppm: PPM,

      playerImageKey: "player",
      armImageKey: ARM_IMAGE_KEY,

      // playerState.x/y are pixels
      startXpx: playerState.x,
      startYpx: playerState.y,

      // playerState.a is radians -> Player expects degrees at spawn
      startAngleDeg: Phaser.Math.RadToDeg(playerState.a || 0),

      isLocal,
    });

    this.players.set(sessionId, p);

    // If this is our local player, start camera follow now
    if (isLocal) {
      this.localPlayer = p;
      this.applyCameraMode();
      this.cameras.main.centerOn(p.sprite.x, p.sprite.y);
      return;
    }

    // Remote player: set initial target pose immediately
    p.setNetTargetPose(playerState.x, playerState.y, playerState.a || 0, playerState.dir || 1);

    // Remote player: whenever x/y/a/dir changes, update the target pose
    const unsubs = [];

    const pushUnsub = (fn) => {
      if (typeof fn === "function") unsubs.push(fn);
    };

    // One helper so all listeners do the same thing
    const updateRemoteTarget = () => {
      const rp = this.players.get(sessionId);
      if (!rp) return;
      rp.setNetTargetPose(playerState.x, playerState.y, playerState.a || 0, playerState.dir || 1);
    };

    pushUnsub(this.callbacks.listen(playerState, "x", updateRemoteTarget));
    pushUnsub(this.callbacks.listen(playerState, "y", updateRemoteTarget));
    pushUnsub(this.callbacks.listen(playerState, "a", updateRemoteTarget));
    pushUnsub(this.callbacks.listen(playerState, "dir", updateRemoteTarget));

    this.netUnsubs.set(sessionId, unsubs);
  }

  despawnPlayer(sessionId) {
    const p = this.players.get(sessionId);
    if (!p) return;

    // Unsubscribe listeners (remote players)
    const unsubs = this.netUnsubs.get(sessionId);
    if (unsubs) {
      for (const fn of unsubs) fn();
      this.netUnsubs.delete(sessionId);
    }

    // Destroy sprites/physics body
    p.destroy();
    this.players.delete(sessionId);

    // If our local player left (rare), clear references
    if (sessionId === this.localSessionId) {
      this.localPlayer = null;
      this.localSessionId = null;
    }
  }

  // ==========================================================
  // CAMERA
  // ==========================================================
  applyCameraMode() {
    const cam = this.cameras.main;

    if (this.cameraFollowEnabled && this.localPlayer) {
      cam.startFollow(this.localPlayer.sprite);
      cam.setLerp(CAMERA_FOLLOW_LERP_X, CAMERA_FOLLOW_LERP_Y);
      cam.setDeadzone(CAMERA_DEADZONE_W_PX, CAMERA_DEADZONE_H_PX);
    } else {
      cam.stopFollow();
      cam.setDeadzone(0, 0);
      cam.setLerp(1, 1);
    }
  }

  updateCameraControls(dt) {
    // Toggle follow/manual
    if (Phaser.Input.Keyboard.JustDown(this.camKeys.toggle)) {
      this.cameraFollowEnabled = !this.cameraFollowEnabled;
      this.applyCameraMode();
    }

    // If following player, manual keys do nothing
    if (this.cameraFollowEnabled) return;

    const cam = this.cameras.main;
    const spd = CAMERA_MANUAL_SPEED_PX_PER_SEC;

    if (this.camKeys.left.isDown) cam.scrollX -= spd * dt;
    if (this.camKeys.right.isDown) cam.scrollX += spd * dt;
    if (this.camKeys.up.isDown) cam.scrollY -= spd * dt;
    if (this.camKeys.down.isDown) cam.scrollY += spd * dt;

    // Clamp to bounds
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;

    const minScrollX = this.camBounds.x;
    const maxScrollX = this.camBounds.x + this.camBounds.w - viewW;

    const minScrollY = this.camBounds.y;
    const maxScrollY = this.camBounds.y + this.camBounds.h - viewH;

    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, minScrollX, Math.max(minScrollX, maxScrollX));
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minScrollY, Math.max(minScrollY, maxScrollY));
  }

  // ==========================================================
  // INPUT PACKET
  // ==========================================================
  buildLocalInput() {
    return {
      tiltLeft: this.keys.tiltLeft.isDown,
      tiltRight: this.keys.tiltRight.isDown,
    };
  }

  // ==========================================================
  // POINTER FORWARDING (ONLY local)
  // ==========================================================
  setupMouseControls() {
    this.input.on("pointerdown", (pointer) => {
      if (!this.localPlayer) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.localPlayer.handlePointerDown(world.x, world.y);
    });

    this.input.on("pointermove", (pointer) => {
      if (!this.localPlayer) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.localPlayer.handlePointerMove(world.x, world.y);
    });

    this.input.on("pointerup", () => {
      if (!this.localPlayer) return;
      this.localPlayer.handlePointerUp();
    });

    this.input.on("pointerupoutside", () => {
      if (!this.localPlayer) return;
      this.localPlayer.handlePointerUp();
    });
  }

  // ==========================================================
  // NETWORK: send local pose to server
  // ==========================================================
  sendLocalPoseIfReady(dt) {
    if (!this.room) return;
    if (!this.localPlayer) return;

    this.netSendAcc += dt;
    if (this.netSendAcc < this.netSendInterval) return;
    this.netSendAcc = 0;

    const p = this.localPlayer.body.getPosition();
    const a = this.localPlayer.body.getAngle();

    // Send pixels + radians + facing
    this.room.send("pose", {
      x: p.x * PPM,
      y: p.y * PPM,
      a: a,
      dir: this.localPlayer.facingDir,
    });
  }

  // ==========================================================
  // UPDATE LOOP
  // ==========================================================
  update(_, dtMs) {
    const dt = dtMs / 1000;

    // Camera controls
    this.updateCameraControls(dt);

    // Local input
    const localInput = this.localPlayer ? this.buildLocalInput() : null;

    // Local facing
    if (this.localPlayer && localInput) {
      this.localPlayer.updateFacingFromInput(localInput);
      this.localPlayer.applyFacingToSprites();
    }

    // Send pose
    this.sendLocalPoseIfReady(dt);

    // Fixed-step physics
    this.acc += dt;

    while (this.acc >= FIXED_DT) {
      for (const player of this.players.values()) {
        if (player.isLocal) player.fixedUpdate(localInput, FIXED_DT);
        else player.fixedUpdate(null, FIXED_DT);
      }

      this.world.step(FIXED_DT);
      this.acc -= FIXED_DT;
    }

    // Render sync
    for (const player of this.players.values()) {
      player.renderUpdate();
    }
  }
}
