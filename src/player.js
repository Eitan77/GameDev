// ============================================================
// src/player.js
// CLIENT: Render-only player (server authoritative physics).
//
// ✅ No interpolation: snap to latest server snapshot.
// ✅ Death visuals: tint + fade, hide health bar
// ✅ Local player's health is rendered in UIScene (HUD overlay)
// ============================================================

import Phaser from "phaser";
import { GUN_CATALOG } from "./gunCatalog.js";

const PLAYER_ART_FACES_RIGHT = true;

const PLAYER_W_PX = 60;
const PLAYER_H_PX = 180;

const ARM_W_PX = 30;
const ARM_H_PX = 70;

const PLAYER_DEPTH = 5;
const ARM_DEPTH = 7;
const GUN_DEPTH = 5.8;

const GUN_ALONG_ARM_OFFSET_PX = 0;
const GUN_SIDE_OFFSET_PX = 0;

// ------------------------------------------------------------
// Health bar (style preserved)
// ------------------------------------------------------------
const HEALTH_BAR_W_PX = 70;
const HEALTH_BAR_H_PX = 10;

const HEALTH_BAR_OFFSET_FROM_HEAD_PX = 18;

const HEALTH_BAR_BORDER_COLOR = 0x000000;
const HEALTH_BAR_BORDER_ALPHA = 0.9;

const HEALTH_BAR_BG_COLOR = 0x202020;
const HEALTH_BAR_BG_ALPHA = 0.85;

const HEALTH_BAR_FILL_COLOR = 0x00ff00;
const HEALTH_BAR_FILL_ALPHA = 0.95;

// ------------------------------------------------------------
// HUD placement (local player only)  (not used anymore, but safe to keep)
// ------------------------------------------------------------
const HUD_MARGIN_X_PX = 24;
const HUD_MARGIN_Y_PX = 24;
const HUD_DEPTH = 2001; // above most things (GameScene statusText is 2000)

// ------------------------------------------------------------
// Dead visuals
// ------------------------------------------------------------
const DEAD_TINT = 0x777777;
const DEAD_ALPHA = 0.85;

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

export default class Player {
  constructor(opts) {
    this.scene = opts.scene;
    this.sessionId = opts.sessionId;
    this.isLocal = !!opts.isLocal;

    // facing
    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    // latest server state
    this.target = null;

    // death flag (client-side view)
    this.isDead = false;

    // ------------------------
    // main sprite
    // ------------------------
    this.sprite = this.scene.add.image(0, 0, "player");
    this.sprite.setDisplaySize(PLAYER_W_PX, PLAYER_H_PX);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setDepth(PLAYER_DEPTH);

    // ------------------------
    // arm sprite (top anchored)
    // ------------------------
    this.arm = this.scene.add.image(0, 0, "arm");
    this.arm.setDisplaySize(ARM_W_PX, ARM_H_PX);
    this.arm.setOrigin(0.5, 0.0);
    this.arm.setDepth(ARM_DEPTH);

    // ------------------------
    // gun
    // ------------------------
    this.equippedGun = null;
    this.gunSprite = null;

    this._gunId = "";
    this._ammo = 0;

    // ------------------------
    // health
    // ------------------------
    this.maxHealth = 100;
    this.health = 100;

    // ------------------------
    // health bar graphics (same style as before)
    // ------------------------
    const plate = this.scene.add
      .rectangle(
        0,
        0,
        HEALTH_BAR_W_PX + 2,
        HEALTH_BAR_H_PX + 2,
        HEALTH_BAR_BORDER_COLOR,
        HEALTH_BAR_BORDER_ALPHA
      )
      .setOrigin(0.5, 0.5);

    const bg = this.scene.add
      .rectangle(0, 0, HEALTH_BAR_W_PX, HEALTH_BAR_H_PX, HEALTH_BAR_BG_COLOR, HEALTH_BAR_BG_ALPHA)
      .setOrigin(0.5, 0.5);

    this.healthFill = this.scene.add
      .rectangle(
        -HEALTH_BAR_W_PX / 2,
        0,
        HEALTH_BAR_W_PX,
        HEALTH_BAR_H_PX,
        HEALTH_BAR_FILL_COLOR,
        HEALTH_BAR_FILL_ALPHA
      )
      .setOrigin(0, 0.5);

    this.healthBar = this.scene.add.container(0, 0, [plate, bg, this.healthFill]);

    // Local = HUD depth, others = world depth
    this.healthBar.setDepth(this.isLocal ? HUD_DEPTH : 50);

    // Local player health is rendered in the HUD overlay (UIScene), so hide this.
    if (this.isLocal) this.healthBar.setVisible(false);

    // apply initial visuals
    this.applyDeadVisuals();
  }

  destroy() {
    if (this.gunSprite) this.gunSprite.destroy();
    if (this.healthBar) this.healthBar.destroy(true);
    if (this.arm) this.arm.destroy();
    if (this.sprite) this.sprite.destroy();

    this.gunSprite = null;
    this.healthBar = null;
    this.healthFill = null;
    this.arm = null;
    this.sprite = null;
  }

  // ------------------------------------------------------------
  // Dead visuals (tint, alpha, hide health bar)
  // ------------------------------------------------------------
  applyDeadVisuals() {
    if (!this.sprite || !this.arm) return;

    if (this.isDead) {
      this.sprite.setTint(DEAD_TINT);
      this.arm.setTint(DEAD_TINT);

      this.sprite.setAlpha(DEAD_ALPHA);
      this.arm.setAlpha(DEAD_ALPHA);

      if (this.gunSprite) {
        this.gunSprite.setTint(DEAD_TINT);
        this.gunSprite.setAlpha(DEAD_ALPHA);
      }

      if (this.healthBar) this.healthBar.setVisible(false);
    } else {
      this.sprite.clearTint();
      this.arm.clearTint();

      this.sprite.setAlpha(1);
      this.arm.setAlpha(1);

      if (this.gunSprite) {
        this.gunSprite.clearTint();
        this.gunSprite.setAlpha(1);
      }

      // Local player health is rendered in the HUD overlay (UIScene)
      if (this.healthBar) this.healthBar.setVisible(!this.isLocal);
    }
  }

  // ------------------------------------------------------------
  // Read server schema state into local target
  // ------------------------------------------------------------
  setTargetFromState(s) {
    const x = Number(s.x) || 0;
    const y = Number(s.y) || 0;
    const a = Number(s.a) || 0;

    const armX = Number(s.armX) || x;
    const armY = Number(s.armY) || y;
    const armA = Number(s.armA) || a;

    const dir = s.dir === 1 || s.dir === -1 ? s.dir : this.facingDir;

    const gunId = typeof s.gunId === "string" ? s.gunId : "";
    const ammo = Number(s.ammo) || 0;

    const maxHealth = Number(s.maxHealth) || this.maxHealth || 100;
    const health = Number(s.health);
    const safeHealth = Number.isFinite(health) ? health : this.health;

    // dead flag from server (fallback: health <= 0)
    const dead = typeof s.dead === "boolean" ? s.dead : safeHealth <= 0;

    this.target = {
      x,
      y,
      a,
      armX,
      armY,
      armA,
      dir,
      gunId,
      ammo,
      maxHealth,
      health: safeHealth,
      dead,
    };

    this.maxHealth = maxHealth;
    this.health = safeHealth;

    this.isDead = dead;

    this.facingDir = dir;
    this.applyFacingToSprites();

    if (gunId !== this._gunId) {
      this._gunId = gunId;
      this._ammo = ammo;
      this.setGunById(gunId);
    } else {
      this._ammo = ammo;
    }

    this.applyDeadVisuals();
  }

  // ------------------------------------------------------------
  // Gun
  // ------------------------------------------------------------
  setGunById(gunId) {
    if (this.gunSprite) {
      this.gunSprite.destroy();
      this.gunSprite = null;
    }
    this.equippedGun = null;

    if (!gunId) return;

    const def = GUN_CATALOG[gunId];
    if (!def) return;

    this.equippedGun = def;

    this.gunSprite = this.scene.add.image(0, 0, def.heldKey);
    this.gunSprite.setDisplaySize(def.heldWpx ?? 110, def.heldHpx ?? 28);
    this.gunSprite.setOrigin(def.heldOriginX ?? 0.2, def.heldOriginY ?? 0.5);
    this.gunSprite.setDepth(def.heldDepth ?? GUN_DEPTH);

    this.applyFacingToSprites();
    this.updateGunSpriteTransform();

    this.applyDeadVisuals();
  }

  applyFacingToSprites() {
    const flip = PLAYER_ART_FACES_RIGHT ? this.facingDir === -1 : this.facingDir === +1;

    this.sprite.setFlipX(flip);
    if (this.arm) this.arm.setFlipX(flip);

    if (this.gunSprite && this.equippedGun) {
      const flipWith = this.equippedGun.heldFlipWithPlayer !== false;

      this.gunSprite.setFlipX(flipWith ? flip : false);

      const baseOX = this.equippedGun.heldOriginX ?? 0.2;
      const baseOY = this.equippedGun.heldOriginY ?? 0.5;

      const ox = flipWith && flip ? 1 - baseOX : baseOX;
      this.gunSprite.setOrigin(ox, baseOY);
    }
  }

  updateGunSpriteTransform() {
    if (!this.gunSprite || !this.equippedGun) return;
    if (!this.arm) return;

    const topX = this.arm.x;
    const topY = this.arm.y;
    const a = this.arm.rotation;

    const downX = -Math.sin(a);
    const downY = Math.cos(a);

    const rightX = Math.cos(a);
    const rightY = Math.sin(a);

    const handX = topX + downX * ARM_H_PX;
    const handY = topY + downY * ARM_H_PX;

    const flipWith = this.equippedGun.heldFlipWithPlayer !== false;
    const mirrorDir = flipWith && this.gunSprite.flipX ? -1 : +1;

    const along = this.equippedGun.heldAlongArmOffsetPx ?? GUN_ALONG_ARM_OFFSET_PX;
    const sideBase = this.equippedGun.heldSideOffsetPx ?? GUN_SIDE_OFFSET_PX;
    const side = sideBase * mirrorDir;

    this.gunSprite.x = handX + downX * along + rightX * side;
    this.gunSprite.y = handY + downY * along + rightY * side;

    const angOff = this.equippedGun.heldAngleOffsetRad ?? 0;
    this.gunSprite.rotation = a + angOff * mirrorDir;
  }

  // ------------------------------------------------------------
  // Health bar update:
  // - Remote players: above head (world-space)
  // - Local player: rendered in UIScene (HUD overlay)
  // ------------------------------------------------------------
  updateHealthBar() {
    if (!this.healthBar || !this.healthFill || this.isDead) return;

    // Local player health is rendered in the HUD overlay (UIScene)
    if (this.isLocal) return;

    // update fill amount (same behavior)
    const mh = Math.max(1, Number(this.maxHealth) || 100);
    const hp = Math.max(0, Math.min(mh, Number(this.health) || 0));
    const ratio = clamp01(hp / mh);

    this.healthFill.width = HEALTH_BAR_W_PX * ratio;
    this.healthFill.x = -HEALTH_BAR_W_PX / 2;

    // Remote players: above head
    const topY = this.sprite.y - PLAYER_H_PX / 2;
    this.healthBar.setScale(1);
    this.healthBar.x = this.sprite.x;
    this.healthBar.y = topY - HEALTH_BAR_OFFSET_FROM_HEAD_PX;
  }

  // ------------------------------------------------------------
  // Render update (snap to server)
  // ------------------------------------------------------------
  update(_deltaSec) {
    if (!this.target) return;

    // SNAP: no lerp
    this.sprite.x = this.target.x;
    this.sprite.y = this.target.y;
    this.sprite.rotation = this.target.a;

    this.arm.x = this.target.armX;
    this.arm.y = this.target.armY;
    this.arm.rotation = this.target.armA;

    this.facingDir = this.target.dir;
    this.applyFacingToSprites();
    this.updateGunSpriteTransform();

    // sync dead flag continuously
    this.isDead = !!this.target.dead || Number(this.target.health) <= 0;
    this.applyDeadVisuals();

    // health bar (REMOTE only)
    this.updateHealthBar();
  }
}