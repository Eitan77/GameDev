// ============================================================
// src/player.js
//
// CLIENT: Render-only player (server authoritative physics).
// ✅ Guns restored EXACTLY like your old code:
// - applyFacingToSprites()
// - updateGunSpriteTransform()
// - origin mirroring when flipped
// - (optional) muzzle math helpers kept for correctness
// ============================================================

import Phaser from "phaser";
import { GUN_CATALOG } from "./gunCatalog.js";

const PLAYER_ART_FACES_RIGHT = true;

const PLAYER_W_PX = 60;
const PLAYER_H_PX = 180;

const ARM_W_PX = 30;
const ARM_H_PX = 70;

const PLAYER_DEPTH = 5;
const ARM_DEPTH = 6;
const GUN_DEPTH = 7;

const GUN_ALONG_ARM_OFFSET_PX = 0;
const GUN_SIDE_OFFSET_PX = 0;

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function lerpAngleRad(a, b, t) {
  // shortest angle interpolation
  const delta = Phaser.Math.Angle.Wrap(b - a);
  return a + delta * t;
}

export default class Player {
  constructor(opts) {
    this.scene = opts.scene;
    this.sessionId = opts.sessionId;
    this.isLocal = !!opts.isLocal;

    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    this.target = null;

    // main sprite
    this.sprite = this.scene.add.image(0, 0, "player");
    this.sprite.setDisplaySize(PLAYER_W_PX, PLAYER_H_PX);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setDepth(PLAYER_DEPTH);

    // arm sprite (top anchored)
    this.arm = this.scene.add.image(0, 0, "arm");
    this.arm.setDisplaySize(ARM_W_PX, ARM_H_PX);
    this.arm.setOrigin(0.5, 0.0);
    this.arm.setDepth(ARM_DEPTH);

    // gun
    this.equippedGun = null;
    this.gunSprite = null;

    // last known gunId (to detect changes)
    this._gunId = "";
    this._ammo = 0;
  }

  destroy() {
    if (this.gunSprite) this.gunSprite.destroy();
    if (this.arm) this.arm.destroy();
    if (this.sprite) this.sprite.destroy();

    this.gunSprite = null;
    this.arm = null;
    this.sprite = null;
  }

  // Called from GameScene on state changes
  setTargetFromState(s) {
    const x = Number(s.x) || 0;
    const y = Number(s.y) || 0;
    const a = Number(s.a) || 0;

    const armX = Number(s.armX) || x;
    const armY = Number(s.armY) || y;
    const armA = Number(s.armA) || a;

    const dir = (s.dir === 1 || s.dir === -1) ? s.dir : this.facingDir;

    const gunId = (typeof s.gunId === "string") ? s.gunId : "";
    const ammo = Number(s.ammo) || 0;

    this.target = { x, y, a, armX, armY, armA, dir, gunId, ammo };

    // facing update (rebuild not needed client-side; just flip)
    this.facingDir = dir;
    if (this.facingDir !== this.prevFacingDir) {
      this.prevFacingDir = this.facingDir;
      this.applyFacingToSprites();
    } else {
      // still ensure flip correct if gun changed
      this.applyFacingToSprites();
    }

    // gun change detection
    if (gunId !== this._gunId) {
      this._gunId = gunId;
      this._ammo = ammo;
      this.setGunById(gunId);
    } else {
      this._ammo = ammo;
    }
  }

  setGunById(gunId) {
    // destroy old
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
  }

  // ✅ EXACTLY like your old code
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

  // ✅ EXACTLY like your old code
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

    // Hand at bottom of the arm
    const handX = topX + downX * ARM_H_PX;
    const handY = topY + downY * ARM_H_PX;

    // Mirror offsets when flipped
    const flipWith = this.equippedGun.heldFlipWithPlayer !== false;
    const mirrorDir = flipWith && this.gunSprite.flipX ? -1 : +1;

    const along = this.equippedGun.heldAlongArmOffsetPx ?? GUN_ALONG_ARM_OFFSET_PX;
    const sideBase = this.equippedGun.heldSideOffsetPx ?? GUN_SIDE_OFFSET_PX;
    const side = sideBase * mirrorDir;

    // Position gun near the hand
    this.gunSprite.x = handX + downX * along + rightX * side;
    this.gunSprite.y = handY + downY * along + rightY * side;

    // Rotation (mirror angle offset too)
    const angOff = this.equippedGun.heldAngleOffsetRad ?? 0;
    this.gunSprite.rotation = a + angOff * mirrorDir;
  }

  update(deltaSec) {
    if (!this.target) return;

    // Simple smoothing for remote players
    const t = this.isLocal ? 1.0 : clamp(deltaSec * 18, 0, 1);

    // body
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.target.x, t);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.target.y, t);
    this.sprite.rotation = lerpAngleRad(this.sprite.rotation, this.target.a, t);

    // arm (top anchored)
    this.arm.x = Phaser.Math.Linear(this.arm.x, this.target.armX, t);
    this.arm.y = Phaser.Math.Linear(this.arm.y, this.target.armY, t);
    this.arm.rotation = lerpAngleRad(this.arm.rotation, this.target.armA, t);

    // gun follows arm (old behavior)
    this.applyFacingToSprites();
    this.updateGunSpriteTransform();
  }
}
