// ============================================================
// server/src/sim/PlayerSim.js
// Server-side Planck simulation for one player.
// ✅ Gun pose + muzzle + forward + raycast EXACTLY like old client code.
// ✅ Adds ragdoll/death: when dead, ignore player control and let physics go limp.
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
const PLAYER_FRICTION = 0.2;

const FOOT_HALF_W_PX = 22;
const FOOT_HALF_H_PX = 10;
const FOOT_FRICTION = 22;
const FOOT_DENSITY = 0.0;

const BALANCE_TARGET_ANGLE_DEG = 7.5;
const BALANCE_KP = 2000;
const BALANCE_KD = 200;
const BALANCE_MAX_TORQUE = 3500;
const AIR_BALANCE_MULT = 0.01;

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
const DEFAULT_AUTO_AIM_SPEED_DEG_PER_SEC = 540; // degrees/sec
const AUTO_AIM_TARGET_Y_OFFSET_PX = -35; // aim a bit above feet (positive Y is DOWN in this project)

const TILT_MAX_ANGLE_RAD = (TILT_MAX_ANGLE_DEG * Math.PI) / 180;
const MAX_JUMP_ANGLE_RAD = (MAX_JUMP_ANGLE_DEG * Math.PI) / 180;
const TILT_ROTATE_SPEED_RAD_PER_SEC = (TILT_ROTATE_SPEED_DEG_PER_SEC * Math.PI) / 180;

// defaults if missing
const BEAM_DEFAULT_MUZZLE_NORM_X = 0.98;
const BEAM_DEFAULT_MUZZLE_NORM_Y = 0.5;

// ------------------------------------------------------------
// Tiny helpers
// ------------------------------------------------------------
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

// Deterministic “random-ish” sign based on sessionId (so each player topples consistently).
function stableSignFromString(str) {
  const s = String(str || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h & 1) ? +1 : -1;
}

export default class PlayerSim {
  constructor(opts) {
    // world + networking identity
    this.world = opts.world;
    this.mouseGroundBody = opts.mouseGroundBody;
    this.sessionId = opts.sessionId;
    this.gunCatalog = opts.gunCatalog;

    // facing + weapon state
    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    this.gunId = "";
    this.ammo = 0;

    // used to detect fire presses (sequence number)
    this.lastFireSeq = 0;

    // grounded + tilt/balance state
    this.touchingGround = false;
    this.groundGraceTimer = 0;

    this.prevTiltDir = 0;
    this.activePivotSide = 0;

    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    // mouse dragging
    this.isDragging = false;
    this.mouseJoint = null;

    // planck bodies/joints
    this.body = null;
    this.armBody = null;
    this.armJoint = null;
    this.armTopLocalM = null;

    // death state (ragdoll flag)
    this.dead = false;

    // cached for tilt math
    this.playerBottomLocalYm = this.pxToM(PLAYER_HALF_H_PX);

    // create physics objects
    this.createBody(opts.startXpx, opts.startYpx);
    this.createSwingArm();
  }

  // px <-> meters conversions
  pxToM(px) { return px / PPM; }
  mToPx(m) { return m * PPM; }

  // ------------------------------------------------------------
  // Death / ragdoll API
  // ------------------------------------------------------------
  isDead() {
    return !!this.dead;
  }

  setDead(wantDead) {
    const next = !!wantDead;

    // If already in that state, do nothing.
    if (next === this.dead) return;

    // Save state.
    this.dead = next;

    // If becoming dead:
    if (this.dead) {
      // Cancel drag so user can't keep pulling while dead.
      this.endMouseDrag();

      // Drop gun immediately so dead bodies don't keep weapons.
      this.dropGun();

      // Reset tilt state so respawn doesn't auto-trigger jump behavior.
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      this.holdPastMaxAngleRad = 0;

      // Clear grounding grace so we don't fight balance.
      this.groundGraceTimer = 0;
      this.touchingGround = false;

      // Apply a small “topple” impulse so they visibly fall over.
      // (Sometimes bodies can stay upright if no impulse is applied.)
      if (this.body) {
        const sign = stableSignFromString(this.sessionId);

        // Wake up physics.
        this.body.setAwake(true);

        // Add angular velocity to tip over.
        const avNow = Number(this.body.getAngularVelocity?.() ?? 0) || 0;
        this.body.setAngularVelocity(avNow + sign * 8);

        // Add a tiny sideways/hop velocity.
        const lv = this.body.getLinearVelocity?.();
        const vxNow = Number(lv?.x ?? 0) || 0;
        const vyNow = Number(lv?.y ?? 0) || 0;

        const vxAdd = sign * this.pxToM(140); // sideways push
        const vyAdd = -this.pxToM(60);        // small hop upward

        this.body.setLinearVelocity(Vec2(vxNow + vxAdd, vyNow + vyAdd));
      }
    } else {
      // If reviving: just make sure inputs can work again,
      // (RespawnAt will reset transform/velocities.)
      // Nothing required here.
    }
  }

  // ------------------------------------------------------------
  // Body creation
  // ------------------------------------------------------------
  createBody(startXpx, startYpx) {
    // main player body
    this.body = this.world.createBody({
      type: "dynamic",
      position: Vec2(this.pxToM(startXpx), this.pxToM(startYpx)),
      fixedRotation: false,
    });

    // Tag for hitscan damage / identification
    this.body.setUserData({ kind: "player", sessionId: this.sessionId });

    // Main box
    const mainFix = this.body.createFixture(
      pl.Box(this.pxToM(PLAYER_HALF_W_PX), this.pxToM(PLAYER_HALF_H_PX)),
      { density: PLAYER_DENSITY, friction: PLAYER_FRICTION }
    );
    mainFix.setUserData("playerBody");

    // Foot (high friction)
    const footCenterLocal = Vec2(0, this.pxToM(PLAYER_HALF_H_PX - FOOT_HALF_H_PX));
    const footFix = this.body.createFixture(
      pl.Box(this.pxToM(FOOT_HALF_W_PX), this.pxToM(FOOT_HALF_H_PX), footCenterLocal, 0),
      { density: FOOT_DENSITY, friction: FOOT_FRICTION }
    );
    footFix.setUserData("foot");
  }

  // ------------------------------------------------------------
  // Arm creation
  // ------------------------------------------------------------
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
    // Shoulder location in player local-space
    const shoulderLocalXpx = ARM_SHOULDER_LOCAL_X_PX * this.facingDir;
    const shoulderLocalYpx = ARM_SHOULDER_LOCAL_Y_PX;

    // Convert shoulder to world point
    const shoulderLocal = Vec2(this.pxToM(shoulderLocalXpx), this.pxToM(shoulderLocalYpx));
    const shoulderWorld = this.body.getWorldPoint(shoulderLocal);

    // Arm dimensions (meters)
    const armHalfWm = this.pxToM(ARM_W_PX / 2);
    const armHalfHm = this.pxToM(ARM_H_PX / 2);

    // Arm top anchor is local (0, -halfH)
    this.armTopLocalM = Vec2(0, -armHalfHm);

    // Start arm with same angle as body
    const startAngle = this.body.getAngle();

    // Position arm so its TOP sits at the shoulder point
    const topOffsetRot = rotateXY(0, -armHalfHm, startAngle);
    const armCenter = Vec2(shoulderWorld.x - topOffsetRot.x, shoulderWorld.y - topOffsetRot.y);

    // Create arm body
    this.armBody = this.world.createBody({
      type: "dynamic",
      position: armCenter,
      angle: startAngle,
      fixedRotation: false,
    });

    // Arm fixture (sensor so it doesn't collide)
    const armFix = this.armBody.createFixture(pl.Box(armHalfWm, armHalfHm), {
      density: ARM_DENSITY,
      friction: 0,
    });

    // Tag arm fixture
    armFix.setUserData("arm");

    // Make arm sensor + collision filtered out
    armFix.setSensor(true);
    armFix.setFilterData({ categoryBits: 0x0004, maskBits: 0x0000 });

    // Damping so it swings nicely
    this.armBody.setLinearDamping(ARM_LINEAR_DAMPING);
    this.armBody.setAngularDamping(ARM_ANGULAR_DAMPING);

    // Revolute joint at shoulder
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

  // Re-anchor the arm when facing changes, WITHOUT resetting its world angle.
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

  // ------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------
  destroy() {
    this.endMouseDrag();
    this.destroySwingArm();
    if (this.body) {
      this.world.destroyBody(this.body);
      this.body = null;
    }
  }

  // ------------------------------------------------------------
  // Respawn (server authoritative)
  // - Revives player (dead=false)
  // - Teleports body, clears velocity, drops gun, resets tilt state
  // ------------------------------------------------------------
  respawnAt(xPx, yPx) {
    const x = Number(xPx) || 0;
    const y = Number(yPx) || 0;

    // Make sure we are alive again.
    this.setDead(false);

    // cancel drag joint (if any)
    this.endMouseDrag();

    // reset tilt/balance state so you don't "release-jump" on spawn
    this.prevTiltDir = 0;
    this.activePivotSide = 0;
    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    this.groundGraceTimer = 0;
    this.touchingGround = false;

    // drop weapon on respawn
    this.dropGun();

    // reset transform + velocity
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.body.setTransform(Vec2(this.pxToM(x), this.pxToM(y)), 0);
    this.body.setAwake(true);

    // face right by default (same as your join spawn)
    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    // rebuild the swing arm to match the new facing + position
    this.rebuildArmForFacing();
  }

  // ------------------------------------------------------------
  // Drag joint (mouse)
  // ------------------------------------------------------------
  startMouseDrag(worldXpx, worldYpx) {
    if (this.isDragging) return;

    const bp = this.body.getPosition();
    const bpx = this.mToPx(bp.x);
    const bpy = this.mToPx(bp.y);

    const dx = worldXpx - bpx;
    const dy = worldYpx - bpy;

    // too far away => ignore
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

    // if not dragging, ensure joint is gone
    if (!wantDrag) {
      this.endMouseDrag();
      return;
    }

    const tx = Number(input?.dragX);
    const ty = Number(input?.dragY);

    // invalid target => stop dragging
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) {
      this.endMouseDrag();
      return;
    }

    // create joint if needed
    if (!this.isDragging || !this.mouseJoint) this.startMouseDrag(tx, ty);

    // update target if joint is active
    if (this.isDragging && this.mouseJoint) {
      this.mouseJoint.setTarget(Vec2(this.pxToM(tx), this.pxToM(ty)));
    }
  }

  // ------------------------------------------------------------
  // Auto-aim helpers
  // ------------------------------------------------------------
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

      // LoS check: raycast to confirm no wall between pivot and target.
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
    // needs gun + arm
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

    // Desired arm “down direction” angle
    const desiredDown = Math.atan2(dy, dx);

    // Arm angle is down - 90deg
    const desiredArmA = wrapRadPi(desiredDown - Math.PI / 2);

    const curA = wrapRadPi(this.armBody.getAngle());
    const err = wrapRadPi(desiredArmA - curA);

    // clamp how far we can rotate this tick
    const maxStep = speedRadPerSec * Math.max(0, Number(fixedDt) || 0);
    const step = clamp(err, -maxStep, +maxStep);
    const nextA = wrapRadPi(curA + step);

    // Move arm so its top stays at the pivot
    const topLocal = this.armTopLocalM;
    const rTop = rotateXY(topLocal.x, topLocal.y, nextA);
    const nextCenter = Vec2(pivotM.x - rTop.x, pivotM.y - rTop.y);

    // Set transform
    this.armBody.setAwake(true);
    this.armBody.setTransform(nextCenter, nextA);
    this.armBody.setAngularVelocity(0);

    // Make arm inherit body velocity (prevents lag)
    const bv = this.body.getLinearVelocity();
    this.armBody.setLinearVelocity(Vec2(bv.x, bv.y));
  }

  // ------------------------------------------------------------
  // Ground rays
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Balance / tilt helpers
  // ------------------------------------------------------------
  computePDTorqueWrapped(targetAngleRad, kp, kd, maxTorque) {
    const angle = wrapRadPi(this.body.getAngle());
    const angVel = this.body.getAngularVelocity();
    const err = wrapRadPi(targetAngleRad - angle);
    const torque = kp * err - kd * angVel;
    return clamp(torque, -maxTorque, maxTorque);
  }

  choosePivotCorner(tiltDir, cornerHits, angleNow, angleTarget) {
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

  applyTiltPinnedToFootCorner(pivotSide, angleTarget) {
    this.body.setAwake(true);

    const posNow = this.body.getPosition();

    const pivotLocalX = pivotSide * this.pxToM(FOOT_HALF_W_PX);
    const pivotLocalY = this.playerBottomLocalYm;

    const pivotLocal = Vec2(pivotLocalX, pivotLocalY);
    const pivotWorld = this.body.getWorldPoint(pivotLocal);

    const rotatedPivot = rotateXY(pivotLocalX, pivotLocalY, angleTarget);
    const posPerfect = Vec2(pivotWorld.x - rotatedPivot.x, pivotWorld.y - rotatedPivot.y);

    const a = clamp(TILT_PIVOT_FOLLOW, 0, 1);
    const posNew = Vec2(
      posNow.x + (posPerfect.x - posNow.x) * a,
      posNow.y + (posPerfect.y - posNow.y) * a
    );

    this.body.setTransform(posNew, angleTarget);
    this.body.setAngularVelocity(0);

    const v = this.body.getLinearVelocity();
    this.body.setLinearVelocity(Vec2(v.x, 0));
  }

  doTiltReleaseJump() {
    const angleNow = wrapRadPi(this.body.getAngle());

    // if too tilted, do NOT jump
    if (Math.abs(angleNow) > MAX_JUMP_ANGLE_RAD) return false;

    const angForJump = clamp(angleNow, -Math.PI / 2, +Math.PI / 2);
    const jumpSpeedMps = this.pxToM(JUMP_SPEED_PX_PER_SEC);

    const vx = Math.sin(angForJump) * jumpSpeedMps;
    const vy = -Math.cos(angForJump) * jumpSpeedMps;

    this.body.setLinearVelocity(Vec2(vx, vy));
    this.body.setAngularVelocity(0);

    this.groundGraceTimer = 0;
    this.touchingGround = false;

    return true;
  }

  // ------------------------------------------------------------
  // Guns
  // ------------------------------------------------------------
  hasGun() { return !!this.gunId; }

  giveGun(gunId) {
    const def = this.gunCatalog?.[gunId];
    if (!def) return false;
    this.gunId = gunId;
    this.ammo = Math.max(0, Math.min(127, Number(def.ammo ?? 0) | 0));
    return true;
  }

  dropGun() { this.gunId = ""; this.ammo = 0; }

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

      // ignore self
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

  raycastBeamEndPx(startPx, dirUnit, maxDistPx) {
    return this.raycastBeamHitPx(startPx, dirUnit, maxDistPx).endPx;
  }

  // ------------------------------------------------------------
  // applyInput (called each server tick before world.step)
  // ------------------------------------------------------------
  applyInput(input, fixedDt) {
    const events = [];

    // ✅ If dead, ignore player control and let physics ragdoll.
    // BUT consume fireSeq so shots don't "buffer" during death.
    if (this.dead) {
      const fireSeqDead = Number(input?.fireSeq) | 0;
      this.lastFireSeq = fireSeqDead;

      // ensure no mouse joint remains
      this.endMouseDrag();

      // no events from dead players
      return events;
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

    // dragging disables tilt/balance
    this.updateMouseDrag(input);

    // ✅ Guard against missing method (prevents your crash)
    if (typeof this.updateAutoAim === "function") {
      this.updateAutoAim(fixedDt);
    }

    // fireSeq -> authoritative shot trigger
    const fireSeq = Number(input?.fireSeq) | 0;
    if (fireSeq !== this.lastFireSeq) {
      this.lastFireSeq = fireSeq;

      const def = this.gunCatalog?.[this.gunId];

      // only shoot if we have ammo and gun uses bullets
      if (def && this.ammo > 0 && def.bulletEnabled) {
        this.ammo = Math.max(0, (this.ammo - 1) | 0);

        const muzzle = this.computeGunMuzzleWorldPx();
        const dir = this.getGunForwardUnit();

        if (muzzle && dir) {
          const maxDistPx = Math.max(10, Number(def.bulletMaxDistancePx ?? 2200));
          const hit = this.raycastBeamHitPx(muzzle, dir, maxDistPx);
          const endPx = hit.endPx;

          // beam event for clients
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

          // damage event for server
          const dmg = Number(def.damage ?? 0);
          if (dmg > 0 && hit.hitSessionId && hit.hitSessionId !== this.sessionId) {
            events.push({
              kind: "damage",
              to: hit.hitSessionId,
              amount: dmg,
              from: this.sessionId,
              gunId: this.gunId,
            });
          }

          // fire sound event
          if (def.fireSoundKey) {
            events.push({
              kind: "sound",
              key: def.fireSoundKey,
              volume: Number(def.fireSoundVolume ?? 1),
              rate: Number(def.fireSoundRate ?? 1),
            });
          }

          // optional delayed reload sound
          if (this.ammo > 0 && def.reloadSoundKey) {
            events.push({
              kind: "soundDelayed",
              delaySec: Number(def.fireToReloadDelaySec ?? 0),
              key: def.reloadSoundKey,
              volume: Number(def.reloadSoundVolume ?? 1),
              rate: Number(def.reloadSoundRate ?? 1),
            });
          }
        }

        // if out of ammo, drop the gun
        if (this.ammo <= 0) {
          this.dropGun();
        }
      }
    }

    // If dragging, do not tilt/balance (same as your original logic)
    if (this.isDragging) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      return events;
    }

    // If no input object, stop here.
    if (!input) return events;

    // Determine tilt direction
    let tiltDir = 0;
    if (input.tiltLeft) tiltDir -= 1;
    if (input.tiltRight) tiltDir += 1;

    const tiltAllowedNow = TILT_ENABLED && this.touchingGround;

    if (!tiltAllowedNow) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
    }

    // Tilt release jump
    if (tiltAllowedNow && this.prevTiltDir !== 0 && tiltDir === 0) {
      const didJump = this.doTiltReleaseJump();

      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;

      if (didJump) return events;
    }

    // Tilt while holding key
    if (tiltAllowedNow && tiltDir !== 0) {
      const angleNow = wrapRadPi(this.body.getAngle());
      const isTiltStartOrSwitch = this.prevTiltDir === 0 || tiltDir !== this.prevTiltDir;

      if (isTiltStartOrSwitch) {
        const pastMaxAbs = Math.abs(angleNow) > TILT_MAX_ANGLE_RAD + TILT_PAST_MAX_EPS_RAD;
        if (pastMaxAbs) {
          this.holdPastMaxActive = true;
          this.holdPastMaxAngleRad = angleNow;
        } else {
          this.holdPastMaxActive = false;
        }
      }

      let angleTarget = angleNow;

      if (this.holdPastMaxActive) {
        angleTarget = this.holdPastMaxAngleRad;
      } else {
        const deltaAng = tiltDir * TILT_ROTATE_SPEED_RAD_PER_SEC * fixedDt;
        angleTarget = clamp(angleNow + deltaAng, -TILT_MAX_ANGLE_RAD, +TILT_MAX_ANGLE_RAD);
      }

      const cornerHits = this.computeFootCornerGroundedByRays();
      const pivotSide = this.choosePivotCorner(tiltDir, cornerHits, angleNow, angleTarget);

      this.activePivotSide = pivotSide;
      this.applyTiltPinnedToFootCorner(pivotSide, angleTarget);

      this.prevTiltDir = tiltDir;
      return events;
    }

    // No tilt => balance
    this.prevTiltDir = 0;
    this.activePivotSide = 0;
    this.holdPastMaxActive = false;

    const balanceTargetRad = (BALANCE_TARGET_ANGLE_DEG * Math.PI) / 180;
    const strengthMult = this.touchingGround ? 1.0 : AIR_BALANCE_MULT;

    const torque = this.computePDTorqueWrapped(
      balanceTargetRad,
      BALANCE_KP * strengthMult,
      BALANCE_KD * strengthMult,
      BALANCE_MAX_TORQUE
    );

    this.body.applyTorque(torque);

    return events;
  }

  // ------------------------------------------------------------
  // Snapshot for state replication
  // ------------------------------------------------------------
  getStateSnapshot() {
    const p = this.body.getPosition();

    const x = Math.round(this.mToPx(p.x));
    const y = Math.round(this.mToPx(p.y));
    const a = this.body.getAngle();

    const armPose = this.getArmPosePx();
    const gunPose = this.computeGunPosePx();

    return {
      x, y, a,
      dir: this.facingDir,

      armX: armPose ? Math.round(armPose.armX) : x,
      armY: armPose ? Math.round(armPose.armY) : y,
      armA: armPose ? armPose.armA : a,

      gunId: this.gunId,
      ammo: this.ammo,

      gunX: gunPose ? Math.round(gunPose.gunX) : 0,
      gunY: gunPose ? Math.round(gunPose.gunY) : 0,
      gunA: gunPose ? gunPose.gunA : 0,
    };
  }
}
