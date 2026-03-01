// PlayerSim.js
// ============================================================
// server/src/sim/PlayerSim.js
// Server-side Planck simulation for one player.
//
// FIXES:
// ✅ Tilting can still slide naturally (keeps vx while tilting)
// ✅ Removes occasional sideways snap when switching far-left -> far-right tilt
//    by rocking about a continuous contact point along the foot bottom
//    + smoothing corner ray flicker with a short grace timer.
// ✅ Removes "weird rotation" right after jumping by suppressing in-air
//    balance torque for a brief moment after jump.
// ============================================================

import planck from "planck";

const pl = planck;
const Vec2 = pl.Vec2;

export const PPM = 30;

const PLAYER_ART_FACES_RIGHT = true;

const PLAYER_W_PX = 60;
const PLAYER_H_PX = 180;
const PLAYER_HALF_W_PX = PLAYER_W_PX / 2;
const PLAYER_HALF_H_PX = PLAYER_H_PX / 2;

const PLAYER_DENSITY = 1.0;
const PLAYER_FRICTION = 0.5;

const FOOT_HALF_W_PX = 22;
const FOOT_HALF_H_PX = 10;
const FOOT_FRICTION = 40;
const FOOT_DENSITY = 0.0;

const BALANCE_TARGET_ANGLE_DEG = 7.5;
const BALANCE_KP = 2000;
const BALANCE_KD = 200;
const BALANCE_MAX_TORQUE = 3500;
const AIR_BALANCE_MULT = 0.04;

const TILT_ENABLED = true;
const TILT_MAX_ANGLE_DEG = 50.3;
const TILT_ROTATE_SPEED_DEG_PER_SEC = 180;
const TILT_PIVOT_FOLLOW = 1.0;
const TILT_PAST_MAX_EPS_RAD = 0.001;

const JUMP_SPEED_PX_PER_SEC = 950;

// If the player's tilt angle (absolute) is ABOVE this, releasing tilt does NOT jump.
const MAX_JUMP_ANGLE_DEG = 80;

export const MOUSE_GRAB_RADIUS_PX = 140;
const MOUSE_DRAG_MAX_FORCE = 9000;
const MOUSE_DRAG_FREQUENCY_HZ = 10;
const MOUSE_DRAG_DAMPING_RATIO = 0.9;

const GROUND_RAY_X_OFFSETS_PX = [-FOOT_HALF_W_PX, 0, FOOT_HALF_W_PX];
const GROUND_RAY_START_INSET_PX = 2;
const GROUND_RAY_LEN_PX = 10;
const GROUND_GRACE_TIME_SEC = 0.06;

// ✅ Corner ray flicker smoothing (movement)
const CORNER_GRACE_TIME_SEC = 0.06;

// ✅ Prevent weird mid-air rotation right after a jump
const JUMP_STABILIZE_TIME_SEC = 0.10;

const CORNER_RAY_X_INSET_PX = 1;

const ARM_W_PX = 30;
const ARM_H_PX = 70;

const ARM_DENSITY = 0.25;
const ARM_LINEAR_DAMPING = 0.3;
const ARM_ANGULAR_DAMPING = 3.0;

const ARM_SHOULDER_LOCAL_X_PX = -8;
const ARM_SHOULDER_LOCAL_Y_PX = -25;

// --------------------
// Auto-aim tuning
// --------------------
const DEFAULT_AUTO_AIM_SPEED_DEG_PER_SEC = 540;
const AUTO_AIM_TARGET_Y_OFFSET_PX = -35;

const TILT_MAX_ANGLE_RAD = (TILT_MAX_ANGLE_DEG * Math.PI) / 180;
const MAX_JUMP_ANGLE_RAD = (MAX_JUMP_ANGLE_DEG * Math.PI) / 180;
const TILT_ROTATE_SPEED_RAD_PER_SEC = (TILT_ROTATE_SPEED_DEG_PER_SEC * Math.PI) / 180;

const BEAM_DEFAULT_MUZZLE_NORM_X = 0.98;
const BEAM_DEFAULT_MUZZLE_NORM_Y = 0.5;

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function wrapRadPi(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function rotateXY(x, y, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: x * c - y * s, y: x * s + y * c };
}

// Small deterministic +/-1 based on sessionId (so ragdoll always topples a bit)
function stableSignFromString(s) {
  const str = String(s ?? "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h & 1) ? 1 : -1;
}

export default class PlayerSim {
  constructor(opts) {
    this.world = opts.world;
    this.mouseGroundBody = opts.mouseGroundBody;
    this.sessionId = opts.sessionId;
    this.gunCatalog = opts.gunCatalog;

    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    this.gunId = "";
    this.ammo = 0;

    this.lastFireSeq = 0;

    // Fire controls (server authoritative)
    this.fireHeld = false;

    // Server-side rate limiting / automatic fire timing
    this._simTimeMs = 0;
    this._nextShotMs = 0;

    // ✅ death / ragdoll state
    this.dead = false;

    this.touchingGround = false;
    this.groundGraceTimer = 0;

    this.prevTiltDir = 0;
    this.activePivotSide = 0;

    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    // ✅ movement smoothing
    this.leftCornerGrace = 0;
    this.rightCornerGrace = 0;

    // ✅ short timer after a jump where we suppress in-air auto-balance torque
    // (removes the "weird rotation" right after jumping)
    this.justJumpedTimer = 0;

    this.isDragging = false;
    this.mouseJoint = null;

    this.body = null;
    this.armBody = null;
    this.armJoint = null;
    this.armTopLocalM = null;

    this.playerBottomLocalYm = this.pxToM(PLAYER_HALF_H_PX);

    this.createBody(opts.startXpx, opts.startYpx);
    this.createSwingArm();
  }

  pxToM(px) { return px / PPM; }
  mToPx(m) { return m * PPM; }

  isDead() {
    return !!this.dead;
  }

  // ✅ Enter/exit ragdoll
  setDead(wantDead) {
    const w = !!wantDead;
    if (w === this.dead) return;

    this.dead = w;

    if (w) {
      // stop any player-controlled joints
      this.endMouseDrag();

      // drop the weapon on death
      this.dropGun();

      // clear movement state so we don't "snap" on revive
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      this.holdPastMaxAngleRad = 0;

      this.leftCornerGrace = 0;
      this.rightCornerGrace = 0;
      this.justJumpedTimer = 0;

      // give a small topple so it actually falls limp
      const s = stableSignFromString(this.sessionId);
      this.body.setAwake(true);
      this.body.setAngularVelocity(this.body.getAngularVelocity() + 3.5 * s);

      const v = this.body.getLinearVelocity();
      this.body.setLinearVelocity(Vec2(v.x + (1.2 * s), v.y));
    } else {
      // revive handled by respawnAt()
      this.body.setAwake(true);
    }
  }

  // ✅ Apply knockback ONLY when dying (called by LobbyRoom on kill)
  applyDeathKnockback(dirX, dirY, strengthPxPerSec, upPxPerSec = 0) {
    if (!this.body) return;

    const k = Number(strengthPxPerSec) || 0;
    if (k <= 0) return;

    const x = Number(dirX);
    const y = Number(dirY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const mag = Math.hypot(x, y);
    if (mag < 1e-6) return;

    const nx = x / mag;
    const ny = y / mag;

    // Convert px/sec => m/sec
    const dvx = (nx * k) / PPM;
    const dvy = (ny * k - (Number(upPxPerSec) || 0)) / PPM;

    const v = this.body.getLinearVelocity();
    this.body.setLinearVelocity(Vec2(v.x + dvx, v.y + dvy));
    this.body.setAwake(true);
  }

  createBody(startXpx, startYpx) {
    this.body = this.world.createBody({
      type: "dynamic",
      position: Vec2(this.pxToM(startXpx), this.pxToM(startYpx)),
      fixedRotation: false,
    });

    // Tag for hitscan damage / identification
    this.body.setUserData({ kind: "player", sessionId: this.sessionId });

    const mainFix = this.body.createFixture(
      pl.Box(this.pxToM(PLAYER_HALF_W_PX), this.pxToM(PLAYER_HALF_H_PX)),
      { density: PLAYER_DENSITY, friction: PLAYER_FRICTION }
    );
    mainFix.setUserData("playerBody");

    const footCenterLocal = Vec2(0, this.pxToM(PLAYER_HALF_H_PX - FOOT_HALF_H_PX));
    const footFix = this.body.createFixture(
      pl.Box(this.pxToM(FOOT_HALF_W_PX), this.pxToM(FOOT_HALF_H_PX), footCenterLocal, 0),
      { density: FOOT_DENSITY, friction: FOOT_FRICTION }
    );
    footFix.setUserData("foot");
  }

  destroySwingArm() {
    if (this.armJoint) {
      this.world.destroyJoint(this.armJoint);
      this.armJoint = null;
    }
    if (this.armBody) {
      this.world.destroyBody(this.armBody);
      this.armBody = null;
    }
    this.armTopLocalM = null;
  }

  createSwingArm() {
    const shoulderLocalXpx = ARM_SHOULDER_LOCAL_X_PX * this.facingDir;
    const shoulderLocalYpx = ARM_SHOULDER_LOCAL_Y_PX;

    const shoulderLocal = Vec2(this.pxToM(shoulderLocalXpx), this.pxToM(shoulderLocalYpx));
    const shoulderWorld = this.body.getWorldPoint(shoulderLocal);

    const armHalfWm = this.pxToM(ARM_W_PX / 2);
    const armHalfHm = this.pxToM(ARM_H_PX / 2);

    this.armTopLocalM = Vec2(0, -armHalfHm);

    const startAngle = this.body.getAngle();
    const topOffsetRot = rotateXY(0, -armHalfHm, startAngle);
    const armCenter = Vec2(shoulderWorld.x - topOffsetRot.x, shoulderWorld.y - topOffsetRot.y);

    this.armBody = this.world.createBody({
      type: "dynamic",
      position: armCenter,
      angle: startAngle,
      fixedRotation: false,
    });

    const armFix = this.armBody.createFixture(pl.Box(armHalfWm, armHalfHm), {
      density: ARM_DENSITY,
      friction: 0,
    });

    armFix.setUserData("arm");
    armFix.setSensor(true);
    armFix.setFilterData({ categoryBits: 0x0004, maskBits: 0x0000 });

    this.armBody.setLinearDamping(ARM_LINEAR_DAMPING);
    this.armBody.setAngularDamping(ARM_ANGULAR_DAMPING);

    this.armJoint = this.world.createJoint(
      pl.RevoluteJoint(
        { collideConnected: false, enableLimit: false, enableMotor: false },
        this.body,
        this.armBody,
        shoulderWorld
      )
    );
  }

  rebuildArmForFacing() {
    this.destroySwingArm();
    this.createSwingArm();
  }

  rebuildArmForFacingPreserveAngle() {
    if (!this.armBody) {
      this.rebuildArmForFacing();
      return;
    }

    const keepAngle = this.armBody.getAngle();
    const keepAngVel = this.armBody.getAngularVelocity();
    const lv = this.armBody.getLinearVelocity();
    const keepLinVel = Vec2(lv.x, lv.y);

    this.destroySwingArm();

    const shoulderLocalXpx = ARM_SHOULDER_LOCAL_X_PX * this.facingDir;
    const shoulderLocalYpx = ARM_SHOULDER_LOCAL_Y_PX;

    const shoulderLocal = Vec2(this.pxToM(shoulderLocalXpx), this.pxToM(shoulderLocalYpx));
    const shoulderWorld = this.body.getWorldPoint(shoulderLocal);

    const armHalfWm = this.pxToM(ARM_W_PX / 2);
    const armHalfHm = this.pxToM(ARM_H_PX / 2);

    this.armTopLocalM = Vec2(0, -armHalfHm);

    const topOffsetRot = rotateXY(0, -armHalfHm, keepAngle);
    const armCenter = Vec2(shoulderWorld.x - topOffsetRot.x, shoulderWorld.y - topOffsetRot.y);

    this.armBody = this.world.createBody({
      type: "dynamic",
      position: armCenter,
      angle: keepAngle,
      fixedRotation: false,
    });

    const armFix = this.armBody.createFixture(pl.Box(armHalfWm, armHalfHm), {
      density: ARM_DENSITY,
      friction: 0,
    });

    armFix.setUserData("arm");
    armFix.setSensor(true);
    armFix.setFilterData({ categoryBits: 0x0004, maskBits: 0x0000 });

    this.armBody.setLinearDamping(ARM_LINEAR_DAMPING);
    this.armBody.setAngularDamping(ARM_ANGULAR_DAMPING);

    this.armJoint = this.world.createJoint(
      pl.RevoluteJoint(
        { collideConnected: false, enableLimit: false, enableMotor: false },
        this.body,
        this.armBody,
        shoulderWorld
      )
    );

    this.armBody.setAwake(true);
    this.armBody.setLinearVelocity(keepLinVel);
    this.armBody.setAngularVelocity(keepAngVel);
  }

  destroy() {
    this.endMouseDrag();
    this.destroySwingArm();
    if (this.body) {
      this.world.destroyBody(this.body);
      this.body = null;
    }
  }

  // --------------------------
  // Respawn (server authoritative)
  // --------------------------
  respawnAt(xPx, yPx) {
    // ✅ revive
    this.setDead(false);

    const x = Number(xPx) || 0;
    const y = Number(yPx) || 0;

    this.endMouseDrag();

    this.prevTiltDir = 0;
    this.activePivotSide = 0;
    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    this.leftCornerGrace = 0;
    this.rightCornerGrace = 0;
    this.justJumpedTimer = 0;

    this.groundGraceTimer = 0;
    this.touchingGround = false;

    // drop weapon on respawn
    this.dropGun();

    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.body.setTransform(Vec2(this.pxToM(x), this.pxToM(y)), 0);
    this.body.setAwake(true);

    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    this.rebuildArmForFacing();
  }

  // --------------------------
  // Drag joint
  // --------------------------
  startMouseDrag(worldXpx, worldYpx) {
    if (this.isDragging) return;

    const bp = this.body.getPosition();
    const bpx = this.mToPx(bp.x);
    const bpy = this.mToPx(bp.y);

    const dx = worldXpx - bpx;
    const dy = worldYpx - bpy;
    if (dx * dx + dy * dy > MOUSE_GRAB_RADIUS_PX * MOUSE_GRAB_RADIUS_PX) return;

    this.isDragging = true;
    this.body.setAwake(true);

    this.mouseJoint = this.world.createJoint(
      pl.MouseJoint(
        {
          maxForce: MOUSE_DRAG_MAX_FORCE,
          frequencyHz: MOUSE_DRAG_FREQUENCY_HZ,
          dampingRatio: MOUSE_DRAG_DAMPING_RATIO,
        },
        this.mouseGroundBody,
        this.body,
        Vec2(this.pxToM(worldXpx), this.pxToM(worldYpx))
      )
    );
  }

  endMouseDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;
    if (this.mouseJoint) {
      this.world.destroyJoint(this.mouseJoint);
      this.mouseJoint = null;
    }
  }

  updateMouseDrag(input) {
    const wantDrag = !!input?.dragActive;

    if (!wantDrag) {
      this.endMouseDrag();
      return;
    }

    const tx = Number(input?.dragX);
    const ty = Number(input?.dragY);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      this.endMouseDrag();
      return;
    }

    if (!this.isDragging || !this.mouseJoint) this.startMouseDrag(tx, ty);
    if (this.isDragging && this.mouseJoint) this.mouseJoint.setTarget(Vec2(this.pxToM(tx), this.pxToM(ty)));
  }

  // --------------------------
  // Auto-aim helpers (unchanged)
  // --------------------------
  getArmPivotWorldM() {
    if (this.armJoint && typeof this.armJoint.getAnchorA === "function") {
      const a = this.armJoint.getAnchorA();
      if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return a;
    }
    if (this.armBody && this.armTopLocalM) {
      const p = this.armBody.getWorldPoint(this.armTopLocalM);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    }
    return null;
  }

  findAutoAimTargetFromPivot(pivotPx, radiusPx) {
    const r = Math.max(0, Number(radiusPx) || 0);
    if (r <= 0) return null;
    const r2 = r * r;

    let best = null;
    let bestD2 = Infinity;

    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const ud = (typeof b.getUserData === "function") ? b.getUserData() : null;
      if (!ud || typeof ud !== "object" || ud.kind !== "player") continue;

      const sid = String(ud.sessionId || "");
      if (!sid || sid === this.sessionId) continue;

      const p = b.getPosition();
      const tx = this.mToPx(p.x);
      const ty = this.mToPx(p.y) + AUTO_AIM_TARGET_Y_OFFSET_PX;

      const dx = tx - pivotPx.x;
      const dy = ty - pivotPx.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      const dist = Math.sqrt(d2) || 0;
      if (dist > 0.001) {
        const dir = { x: dx / dist, y: dy / dist };
        const hit = this.raycastBeamHitPx(pivotPx, dir, dist);
        if (hit?.hitSessionId !== sid) continue;
      }

      if (d2 < bestD2) {
        bestD2 = d2;
        best = { sessionId: sid, x: tx, y: ty };
      }
    }

    return best;
  }

  updateAutoAim(fixedDt) {
    if (!this.hasGun()) return;
    if (!this.armBody || !this.armTopLocalM) return;

    const def = this.gunCatalog?.[this.gunId];
    if (!def) return;

    const radiusPx = Number(def.aimRadiusPx ?? 0);
    if (!(radiusPx > 0)) return;

    const speedDegPerSec = Number(def.autoAimSpeedDegPerSec ?? DEFAULT_AUTO_AIM_SPEED_DEG_PER_SEC);
    const speedRadPerSec = (speedDegPerSec * Math.PI) / 180;

    const pivotM = this.getArmPivotWorldM();
    if (!pivotM) return;

    const pivotPx = { x: this.mToPx(pivotM.x), y: this.mToPx(pivotM.y) };
    const target = this.findAutoAimTargetFromPivot(pivotPx, radiusPx);
    if (!target) return;

    const dx = target.x - pivotPx.x;
    const dy = target.y - pivotPx.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return;

    const desiredDown = Math.atan2(dy, dx);
    const desiredArmA = wrapRadPi(desiredDown - Math.PI / 2);

    const curA = wrapRadPi(this.armBody.getAngle());
    const err = wrapRadPi(desiredArmA - curA);

    const maxStep = speedRadPerSec * Math.max(0, Number(fixedDt) || 0);
    const step = clamp(err, -maxStep, +maxStep);
    const nextA = wrapRadPi(curA + step);

    const topLocal = this.armTopLocalM;
    const rTop = rotateXY(topLocal.x, topLocal.y, nextA);
    const nextCenter = Vec2(pivotM.x - rTop.x, pivotM.y - rTop.y);

    this.armBody.setAwake(true);
    this.armBody.setTransform(nextCenter, nextA);
    this.armBody.setAngularVelocity(0);

    const bv = this.body.getLinearVelocity();
    this.armBody.setLinearVelocity(Vec2(bv.x, bv.y));
  }

  // --------------------------
  // Ground rays
  // --------------------------
  computeGroundedByRays() {
    const rayLenM = this.pxToM(GROUND_RAY_LEN_PX);
    const localStartYM = this.pxToM(PLAYER_HALF_H_PX - GROUND_RAY_START_INSET_PX);
    let anyHit = false;

    for (const xOffPx of GROUND_RAY_X_OFFSETS_PX) {
      const localPoint = Vec2(this.pxToM(xOffPx), localStartYM);
      const start = this.body.getWorldPoint(localPoint);
      const end = Vec2(start.x, start.y + rayLenM);

      this.world.rayCast(start, end, (fixture) => {
        const tag = fixture.getUserData();
        if (tag === "playerBody" || tag === "foot" || tag === "arm") return -1;
        if (tag !== "ground" && tag !== "wall") return -1;
        anyHit = true;
        return 0;
      });
    }

    return anyHit;
  }

  computeFootCornerGroundedByRays() {
    const rayLenM = this.pxToM(GROUND_RAY_LEN_PX);
    const localStartYM = this.pxToM(PLAYER_HALF_H_PX - GROUND_RAY_START_INSET_PX);

    const leftX = this.pxToM(-FOOT_HALF_W_PX + CORNER_RAY_X_INSET_PX);
    const rightX = this.pxToM(+FOOT_HALF_W_PX - CORNER_RAY_X_INSET_PX);

    const castOne = (localX) => {
      const localPoint = Vec2(localX, localStartYM);
      const start = this.body.getWorldPoint(localPoint);
      const end = Vec2(start.x, start.y + rayLenM);

      let hit = false;
      this.world.rayCast(start, end, (fixture) => {
        const tag = fixture.getUserData();
        if (tag === "playerBody" || tag === "foot" || tag === "arm") return -1;
        if (tag !== "ground" && tag !== "wall") return -1;
        hit = true;
        return 0;
      });

      return hit;
    };

    return { leftHit: castOne(leftX), rightHit: castOne(rightX) };
  }

  computePDTorqueWrapped(targetAngleRad, kp, kd, maxTorque) {
    const angle = wrapRadPi(this.body.getAngle());
    const angVel = this.body.getAngularVelocity();
    const err = wrapRadPi(targetAngleRad - angle);
    const torque = kp * err - kd * angVel;
    return clamp(torque, -maxTorque, maxTorque);
  }

  choosePivotCorner(tiltDir, cornerHits, angleNow, angleTarget) {
    // kept (not used in the new rocking method), but left here in case
    // other code still expects it
    let pivotSide = 0;

    if (cornerHits.leftHit && !cornerHits.rightHit) pivotSide = -1;
    if (cornerHits.rightHit && !cornerHits.leftHit) pivotSide = +1;

    if (cornerHits.leftHit && cornerHits.rightHit) {
      if (this.holdPastMaxActive) pivotSide = angleNow >= 0 ? +1 : -1;
      else pivotSide = tiltDir;
    }

    if (!cornerHits.leftHit && !cornerHits.rightHit) {
      if (this.activePivotSide !== 0) pivotSide = this.activePivotSide;
      else pivotSide = angleNow >= 0 ? +1 : -1;
    }

    if (this.activePivotSide === +1 && tiltDir === -1 && angleNow > 0 && angleTarget <= 0) pivotSide = -1;
    if (this.activePivotSide === -1 && tiltDir === +1 && angleNow < 0 && angleTarget >= 0) pivotSide = +1;

    return pivotSide;
  }

  // ------------------------------------------------------------
  // Tilt contact / rocking
  //
  // Goal:
  // - Allow natural sliding (keep vx), but remove the occasional *extra* horizontal
  //   shift that happens when switching from far-left tilt to far-right tilt.
  //
  // How:
  // - Instead of always pivoting around a single toe corner that can switch abruptly,
  //   we pivot around a *contact point on the bottom of the foot*.
  // - When BOTH corners are grounded (flat ground), that contact point moves
  //   smoothly between toes based on the current angle (rolling contact).
  // - When only one corner is grounded, we clamp to that toe.
  // ------------------------------------------------------------
  _contactLocalXForAngleM(angleRad, leftGrounded, rightGrounded) {
    const halfWm = this.pxToM(FOOT_HALF_W_PX);

    if (leftGrounded && !rightGrounded) return -halfWm;
    if (rightGrounded && !leftGrounded) return +halfWm;

    if (leftGrounded && rightGrounded) {
      const nx = clamp(angleRad / TILT_MAX_ANGLE_RAD, -1, +1);
      return nx * halfWm;
    }

    // airborne / unknown: rotate around center
    return 0;
  }

  applyTiltPinnedToFootContact(angleNow, angleTarget, leftGrounded, rightGrounded) {
    this.body.setAwake(true);

    const localY = this.playerBottomLocalYm;

    const localXNow = this._contactLocalXForAngleM(angleNow, leftGrounded, rightGrounded);
    const localXTarget = this._contactLocalXForAngleM(angleTarget, leftGrounded, rightGrounded);

    // world anchor is the CURRENT contact point (prevents sudden "snap" when reversing)
    const anchorWorld = this.body.getWorldPoint(Vec2(localXNow, localY));

    // new body position that keeps the anchor fixed while angle changes
    const rotatedTarget = rotateXY(localXTarget, localY, angleTarget);
    const posPerfect = Vec2(anchorWorld.x - rotatedTarget.x, anchorWorld.y - rotatedTarget.y);

    const posNow = this.body.getPosition();
    const a = clamp(TILT_PIVOT_FOLLOW, 0, 1);
    const posNew = Vec2(
      posNow.x + (posPerfect.x - posNow.x) * a,
      posNow.y + (posPerfect.y - posNow.y) * a
    );

    this.body.setTransform(posNew, angleTarget);
    this.body.setAngularVelocity(0);

    // ✅ Allow sliding while tilting: keep horizontal velocity.
    // Kill vertical while grounded to avoid jitter from setTransform.
    const v = this.body.getLinearVelocity();
    this.body.setLinearVelocity(Vec2(v.x, 0));

    // keep a notion of which "side" we're leaning to
    if (Math.abs(localXTarget) > 1e-6) this.activePivotSide = localXTarget > 0 ? +1 : -1;
    else this.activePivotSide = angleTarget >= 0 ? +1 : -1;
  }

  // Backwards-compatible helper (used by older code paths)
  applyTiltPinnedToFootCorner(pivotSide, angleTarget) {
    const angleNow = wrapRadPi(this.body.getAngle());
    const leftGrounded = pivotSide < 0;
    const rightGrounded = pivotSide > 0;
    this.applyTiltPinnedToFootContact(angleNow, angleTarget, leftGrounded, rightGrounded);
  }

  doTiltReleaseJump() {
    const angleNow = wrapRadPi(this.body.getAngle());
    if (Math.abs(angleNow) > MAX_JUMP_ANGLE_RAD) return false;

    const angForJump = clamp(angleNow, -Math.PI / 2, +Math.PI / 2);
    const jumpSpeedMps = this.pxToM(JUMP_SPEED_PX_PER_SEC);

    const vx = Math.sin(angForJump) * jumpSpeedMps;
    const vy = -Math.cos(angForJump) * jumpSpeedMps;

    this.body.setLinearVelocity(Vec2(vx, vy));
    this.body.setAngularVelocity(0);

    this.groundGraceTimer = 0;
    this.touchingGround = false;

    // ✅ suppress in-air auto-balance torque right after jumping
    this.justJumpedTimer = JUMP_STABILIZE_TIME_SEC;

    return true;
  }

  // --------------------------
  // Guns
  // --------------------------
  hasGun() { return !!this.gunId; }

  giveGun(gunId) {
    const def = this.gunCatalog?.[gunId];
    if (!def) return false;

    this.gunId = gunId;
    this.ammo = Math.max(0, Math.min(127, Number(def.ammo ?? 0) | 0));

    // allow an immediate shot after pickup
    this._nextShotMs = this._simTimeMs;
    this.fireHeld = false;

    return true;
  }

  dropGun() {
    this.gunId = "";
    this.ammo = 0;
    this._nextShotMs = this._simTimeMs;
    this.fireHeld = false;
  }

  getArmPosePx() {
    if (!this.armBody || !this.armTopLocalM) return null;
    const topWorld = this.armBody.getWorldPoint(this.armTopLocalM);
    return {
      armX: this.mToPx(topWorld.x),
      armY: this.mToPx(topWorld.y),
      armA: this.armBody.getAngle(),
    };
  }

  computeGunPosePx() {
    if (!this.gunId) return null;
    const def = this.gunCatalog?.[this.gunId];
    if (!def) return null;

    const armPose = this.getArmPosePx();
    if (!armPose) return null;

    const topX = armPose.armX;
    const topY = armPose.armY;
    const a = armPose.armA;

    const downX = -Math.sin(a);
    const downY = Math.cos(a);

    const rightX = Math.cos(a);
    const rightY = Math.sin(a);

    const handX = topX + downX * ARM_H_PX;
    const handY = topY + downY * ARM_H_PX;

    const flipPlayer = PLAYER_ART_FACES_RIGHT ? this.facingDir === -1 : this.facingDir === +1;

    const flipWith = def.heldFlipWithPlayer !== false;
    const gunFlip = flipWith ? flipPlayer : false;

    const mirrorDir = (flipWith && gunFlip) ? -1 : +1;

    const along = def.heldAlongArmOffsetPx ?? 0;
    const sideBase = def.heldSideOffsetPx ?? 0;
    const side = sideBase * mirrorDir;

    const gunX = handX + downX * along + rightX * side;
    const gunY = handY + downY * along + rightY * side;

    const angOff = def.heldAngleOffsetRad ?? 0;
    const gunA = a + angOff * mirrorDir;

    const baseOX = def.heldOriginX ?? 0.2;
    const baseOY = def.heldOriginY ?? 0.5;
    const originX = (flipWith && gunFlip) ? (1 - baseOX) : baseOX;
    const originY = baseOY;

    return {
      gunX,
      gunY,
      gunA,
      gunFlip,
      originX,
      originY,
      w: def.heldWpx ?? 110,
      h: def.heldHpx ?? 28,
      muzzleNx: Number(def.bulletMuzzleNormX ?? BEAM_DEFAULT_MUZZLE_NORM_X),
      muzzleNy: Number(def.bulletMuzzleNormY ?? BEAM_DEFAULT_MUZZLE_NORM_Y),
    };
  }

  computeGunMuzzleWorldPx() {
    const pose = this.computeGunPosePx();
    if (!pose) return null;

    const nx = pose.muzzleNx;
    const ny = pose.muzzleNy;

    const nxEff = pose.gunFlip ? (1 - nx) : nx;

    const localX = (nxEff - pose.originX) * pose.w;
    const localY = (ny - pose.originY) * pose.h;

    const c = Math.cos(pose.gunA);
    const s = Math.sin(pose.gunA);

    const worldX = pose.gunX + localX * c - localY * s;
    const worldY = pose.gunY + localX * s + localY * c;

    return { x: worldX, y: worldY };
  }

  getGunForwardUnit() {
    const pose = this.computeGunPosePx();
    if (!pose) return null;

    let dx = Math.cos(pose.gunA);
    let dy = Math.sin(pose.gunA);

    const mirror = pose.gunFlip ? -1 : +1;
    dx *= mirror;
    dy *= mirror;

    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  raycastBeamHitPx(startPx, dirUnit, maxDistPx) {
    const startM = Vec2(this.pxToM(startPx.x), this.pxToM(startPx.y));
    const endPx = { x: startPx.x + dirUnit.x * maxDistPx, y: startPx.y + dirUnit.y * maxDistPx };
    const endM = Vec2(this.pxToM(endPx.x), this.pxToM(endPx.y));

    let bestFraction = 1.0;
    let bestPointM = null;
    let bestHitSessionId = null;

    this.world.rayCast(startM, endM, (fixture, point, _normal, fraction) => {
      if (!fixture) return -1;

      if (typeof fixture.isSensor === "function" && fixture.isSensor()) return -1;

      const body = fixture.getBody();
      if (body === this.body || body === this.armBody) return -1;

      if (fraction < bestFraction) {
        bestFraction = fraction;
        bestPointM = point;

        const ud = (typeof body.getUserData === "function") ? body.getUserData() : null;
        if (ud && typeof ud === "object" && ud.kind === "player" && typeof ud.sessionId === "string") {
          bestHitSessionId = ud.sessionId;
        } else {
          bestHitSessionId = null;
        }
      }

      return fraction;
    });

    const hitEndPx = bestPointM ? { x: this.mToPx(bestPointM.x), y: this.mToPx(bestPointM.y) } : endPx;
    return { endPx: hitEndPx, hitSessionId: bestHitSessionId };
  }

  // Called by LobbyRoom each tick BEFORE world.step
  applyInput(input, fixedDt) {
    // Fixed-step simulation time (ms), used for fire-rate limiting.
    this._simTimeMs += Math.max(0, Number(fixedDt) || 0) * 1000;

    // ✅ If dead: no movement forces, no tilt/jump, no auto-aim, no firing.
    if (this.dead) {
      this.endMouseDrag();
      this.fireHeld = false;
      this.lastFireSeq = Number(input?.fireSeq) | 0;
      return [];
    }

    // facing from input
    if (input) {
      const leftDown = !!input.tiltLeft;
      const rightDown = !!input.tiltRight;

      if (leftDown && !rightDown) this.facingDir = -1;
      else if (rightDown && !leftDown) this.facingDir = +1;

      if (this.facingDir !== this.prevFacingDir) {
        this.prevFacingDir = this.facingDir;
        this.rebuildArmForFacingPreserveAngle();
      }
    }

    // ground grace
    const rawGrounded = this.computeGroundedByRays();
    if (rawGrounded) this.groundGraceTimer = GROUND_GRACE_TIME_SEC;
    else this.groundGraceTimer = Math.max(0, this.groundGraceTimer - fixedDt);
    this.touchingGround = this.groundGraceTimer > 0;

    // ✅ decay jump-stabilize timer
    this.justJumpedTimer = Math.max(0, this.justJumpedTimer - fixedDt);

    // dragging disables tilt/balance
    this.updateMouseDrag(input);

    if (typeof this.updateAutoAim === "function") {
      this.updateAutoAim(fixedDt);
    }

    const events = [];

    // ------------------------------------------------------------
    // Guns (server authoritative)
    // - `fireSeq` is a *press* edge (semi-auto behavior)
    // - `fireHeld` enables continuous fire ONLY for guns with `automatic: true`
    // - `timeBetweenShots` (ms) rate-limits both modes
    // ------------------------------------------------------------

    const def = this.gunCatalog?.[this.gunId] || null;
    const timeBetweenShotsMs = Math.max(0, Number(def?.timeBetweenShots ?? 0) || 0);
    const isAutomatic = !!def?.automatic;

    // snapshot current held state (missing => false)
    this.fireHeld = !!input?.fireHeld;

    const canFireNow = () => this._simTimeMs >= this._nextShotMs;

    const tryFireOnce = () => {
      if (!def) return false;
      if (this.ammo <= 0) return false;
      if (!def.bulletEnabled) return false;
      if (!canFireNow()) return false;

      const gunIdFired = this.gunId;

      this.ammo = Math.max(0, (this.ammo - 1) | 0);

      const muzzle = this.computeGunMuzzleWorldPx();
      const dir = this.getGunForwardUnit();

      if (muzzle && dir) {
        const maxDistPx = Math.max(10, Number(def.bulletMaxDistancePx ?? 2200));
        const hit = this.raycastBeamHitPx(muzzle, dir, maxDistPx);
        const endPx = hit.endPx;

        events.push({
          kind: "shot",
          sx: muzzle.x,
          sy: muzzle.y,
          ex: endPx.x,
          ey: endPx.y,
          widthPx: Number(def.bulletWidthPx ?? 10),
          lifeSec: Number(def.bulletLifetimeSec ?? 0.05),
          tailLenPx: Number(def.bulletTailLengthPx ?? 200),
          color: Number(def.bulletColor ?? 0xffffff),
        });

        const dmg = Number(def.damage ?? 0);
        if (dmg > 0 && hit.hitSessionId && hit.hitSessionId !== this.sessionId) {
          events.push({
            kind: "damage",
            to: hit.hitSessionId,
            amount: dmg,
            from: this.sessionId,
            gunId: gunIdFired,
            kx: dir.x,
            ky: dir.y,
            kb: Number(def.deathKnockbackPxPerSec ?? 0),
            kbu: Number(def.deathKnockbackUpPxPerSec ?? 0),
          });
        }
      }

      // schedule next allowed shot time
      this._nextShotMs = this._simTimeMs + timeBetweenShotsMs;

      if (this.ammo <= 0) {
        this.dropGun();
      }

      return true;
    };

    let firedThisTick = false;

    // fireSeq -> press edge (semi-auto & first-shot for automatic)
    const fireSeq = Number(input?.fireSeq) | 0;
    if (fireSeq !== this.lastFireSeq) {
      this.lastFireSeq = fireSeq;
      firedThisTick = tryFireOnce();
    }

    // automatic -> while held (rate-limited)
    if (!firedThisTick && isAutomatic && this.fireHeld) {
      firedThisTick = tryFireOnce();
    }

    // MOVEMENT
    if (this.isDragging) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      this.leftCornerGrace = 0;
      this.rightCornerGrace = 0;
      return events;
    }

    if (!input) return events;

    let tiltDir = 0;
    if (input.tiltLeft) tiltDir -= 1;
    if (input.tiltRight) tiltDir += 1;

    const tiltAllowedNow = TILT_ENABLED && this.touchingGround;

    if (!tiltAllowedNow) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      this.leftCornerGrace = 0;
      this.rightCornerGrace = 0;
    }

    // Release tilt -> jump
    if (tiltAllowedNow && this.prevTiltDir !== 0 && tiltDir === 0) {
      const didJump = this.doTiltReleaseJump();

      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      this.leftCornerGrace = 0;
      this.rightCornerGrace = 0;

      if (didJump) return events;
    }

    if (tiltAllowedNow && tiltDir !== 0) {
      const angleNow = wrapRadPi(this.body.getAngle());
      const isTiltStartOrSwitch = this.prevTiltDir === 0 || tiltDir !== this.prevTiltDir;

      const cornerHits = this.computeFootCornerGroundedByRays();

      const leftGroundedNow = cornerHits.leftHit;
      const rightGroundedNow = cornerHits.rightHit;

      if (leftGroundedNow) this.leftCornerGrace = CORNER_GRACE_TIME_SEC;
      else this.leftCornerGrace = Math.max(0, this.leftCornerGrace - fixedDt);

      if (rightGroundedNow) this.rightCornerGrace = CORNER_GRACE_TIME_SEC;
      else this.rightCornerGrace = Math.max(0, this.rightCornerGrace - fixedDt);

      const leftGrounded = this.leftCornerGrace > 0;
      const rightGrounded = this.rightCornerGrace > 0;

      const wantAngle = clamp(tiltDir * TILT_MAX_ANGLE_RAD, -TILT_MAX_ANGLE_RAD, +TILT_MAX_ANGLE_RAD);

      const diff = wrapRadPi(wantAngle - angleNow);
      let step = clamp(diff, -TILT_ROTATE_SPEED_RAD_PER_SEC * fixedDt, +TILT_ROTATE_SPEED_RAD_PER_SEC * fixedDt);

      let angleTarget = wrapRadPi(angleNow + step);

      const atMax = Math.abs(angleTarget) >= (TILT_MAX_ANGLE_RAD - TILT_PAST_MAX_EPS_RAD);
      if (atMax) {
        this.holdPastMaxActive = true;
        this.holdPastMaxAngleRad = angleTarget;
      } else {
        if (this.holdPastMaxActive) {
          if (Math.sign(angleTarget) !== Math.sign(this.holdPastMaxAngleRad)) {
            this.holdPastMaxActive = false;
          }
        }
      }

      this.applyTiltPinnedToFootContact(angleNow, angleTarget, leftGrounded, rightGrounded);

      this.prevTiltDir = tiltDir;

      return events;
    }

    // auto-balance if grounded and not tilting
    if (this.touchingGround && this.prevTiltDir === 0) {
      const targetAngle = 0;

      // suppress in-air balance right after jump
      const airMult = this.justJumpedTimer > 0 ? 0 : AIR_BALANCE_MULT;

      const groundedMult = this.touchingGround ? 1 : airMult;

      const torque = this.computePDTorqueWrapped(
        targetAngle,
        BALANCE_KP * groundedMult,
        BALANCE_KD * groundedMult,
        BALANCE_MAX_TORQUE
      );

      this.body.applyTorque(torque);
    }

    this.prevTiltDir = tiltDir;

    return events;
  }

  // --------------------------
  // State snapshot for LobbyRoom
  // --------------------------
  getStateSnapshot() {
    const bp = this.body.getPosition();

    const x = Math.round(this.mToPx(bp.x));
    const y = Math.round(this.mToPx(bp.y));
    const a = this.body.getAngle();

    const dir = this.facingDir;

    const armPose = this.getArmPosePx();
    const armX = Math.round(armPose?.armX ?? x);
    const armY = Math.round(armPose?.armY ?? y);
    const armA = armPose?.armA ?? a;

    const gunPose = this.computeGunPosePx();

    const gunX = Math.round(gunPose?.gunX ?? 0);
    const gunY = Math.round(gunPose?.gunY ?? 0);
    const gunA = gunPose?.gunA ?? 0;

    return {
      x,
      y,
      a,

      armX,
      armY,
      armA,

      dir,

      gunId: this.gunId,
      ammo: this.ammo,

      maxHealth: 100,
      health: 100,
      dead: !!this.dead,

      gunX,
      gunY,
      gunA,
    };
  }
}