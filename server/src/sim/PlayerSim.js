// server/src/sim/PlayerSim.js
// Server-side Planck physics simulation for one player.

import planck from "planck";

const { Vec2, Box, RevoluteJoint, MouseJoint } = planck;

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
const AIR_BALANCE_MULT = 0.05;

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
const GROUND_RAY_LEN_PX = 16;
const GROUND_GRACE_TIME_SEC = 0.06;

// Side rays: fire horizontally left and right from the body midpoint.
// These detect when the player body is resting on a pillar/ledge so
// auto-balance uses full strength even when the foot is off the ground.
const SIDE_RAY_Y_OFFSETS_PX  = [-PLAYER_HALF_H_PX * 0.1, PLAYER_HALF_H_PX * 0.4];  // two heights
const SIDE_RAY_START_INSET_PX = 2;
const SIDE_RAY_LEN_PX         = 14;

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

const EPSILON = 1e-6;

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

    // Per-player tilt speed multiplier (0–1, default 0.5 maps to 1x)
    this.tiltSensitivity = 0.5;

    this.gunId = "";
    this.ammo = 0;

    this.lastFireSeq = 0;
    this.fireHeld = false;

    // Server-side rate limiting / automatic fire timing
    this._simTimeMs = 0;
    this._nextShotMs = 0;

    this.dead = false;

    this.touchingGround = false;
    this.groundGraceTimer = 0;

    // Side rays: body resting on pillar/ledge satisfies auto-balance but NOT tilt/jump.
    this.touchingAnySurface = false;
    this.sideGroundGraceTimer = 0;

    this.prevTiltDir = 0;
    this.activePivotSide = 0;

    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    this.leftCornerGrace = 0;
    this.rightCornerGrace = 0;
    this.tiltRampMult = 1;

    // Suppresses in-air auto-balance torque right after jumping.
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
    return this.dead;
  }

  setDead(wantDead) {
    const w = !!wantDead;
    if (w === this.dead) return;

    this.dead = w;

    if (w) {
      this.endMouseDrag();
      this.dropGun();
      this._resetTiltState();
      this.justJumpedTimer = 0;

      // Give a small topple so it falls limp
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

  // Apply knockback on kill (called by LobbyRoom)
  applyDeathKnockback(dirX, dirY, strengthPxPerSec, upPxPerSec = 0) {
    if (!this.body) return;

    const k = Number(strengthPxPerSec) || 0;
    if (k <= 0) return;

    const x = Number(dirX);
    const y = Number(dirY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const mag = Math.hypot(x, y);
    if (mag < EPSILON) return;

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
      Box(this.pxToM(PLAYER_HALF_W_PX), this.pxToM(PLAYER_HALF_H_PX)),
      { density: PLAYER_DENSITY, friction: PLAYER_FRICTION }
    );
    mainFix.setUserData("playerBody");

    const footCenterLocal = Vec2(0, this.pxToM(PLAYER_HALF_H_PX - FOOT_HALF_H_PX));
    const footFix = this.body.createFixture(
      Box(this.pxToM(FOOT_HALF_W_PX), this.pxToM(FOOT_HALF_H_PX), footCenterLocal, 0),
      { density: FOOT_DENSITY, friction: FOOT_FRICTION }
    );
    footFix.setUserData("foot");
  }

  _resetTiltState() {
    this.prevTiltDir = 0;
    this.activePivotSide = 0;
    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;
    this.leftCornerGrace = 0;
    this.rightCornerGrace = 0;
    this.tiltRampMult = 1;
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

  // Shared arm body/joint setup. Creates armBody, armJoint, armTopLocalM at `angle`.
  _spawnArmBody(angle) {
    const shoulderLocal = Vec2(
      this.pxToM(ARM_SHOULDER_LOCAL_X_PX * this.facingDir),
      this.pxToM(ARM_SHOULDER_LOCAL_Y_PX)
    );
    const shoulderWorld = this.body.getWorldPoint(shoulderLocal);

    const armHalfWm = this.pxToM(ARM_W_PX / 2);
    const armHalfHm = this.pxToM(ARM_H_PX / 2);

    this.armTopLocalM = Vec2(0, -armHalfHm);

    const topOffsetRot = rotateXY(0, -armHalfHm, angle);
    const armCenter = Vec2(shoulderWorld.x - topOffsetRot.x, shoulderWorld.y - topOffsetRot.y);

    this.armBody = this.world.createBody({
      type: "dynamic",
      position: armCenter,
      angle,
      fixedRotation: false,
    });

    const armFix = this.armBody.createFixture(Box(armHalfWm, armHalfHm), {
      density: ARM_DENSITY,
      friction: 0,
    });
    armFix.setUserData("arm");
    armFix.setSensor(true);
    armFix.setFilterData({ categoryBits: 0x0004, maskBits: 0x0000 });

    this.armBody.setLinearDamping(ARM_LINEAR_DAMPING);
    this.armBody.setAngularDamping(ARM_ANGULAR_DAMPING);

    this.armJoint = this.world.createJoint(
      RevoluteJoint(
        { collideConnected: false, enableLimit: false, enableMotor: false },
        this.body,
        this.armBody,
        shoulderWorld
      )
    );
  }

  createSwingArm() {
    this._spawnArmBody(this.body.getAngle());
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
    this._spawnArmBody(keepAngle);

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

  respawnAt(xPx, yPx) {
    this.setDead(false);

    const x = Number(xPx) || 0;
    const y = Number(yPx) || 0;

    this.endMouseDrag();
    this._resetTiltState();
    this.justJumpedTimer = 0;
    this.groundGraceTimer = 0;
    this.touchingGround = false;
    this.sideGroundGraceTimer = 0;
    this.touchingAnySurface = false;
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
      MouseJoint(
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

  // Returns true if this fixture should count as a solid obstacle for ground/wall detection.
  // Accepts both terrain AND other players' bodies, so players can stand on each other.
  // Skips own body parts and all sensor fixtures (arms, etc.).
  _isBlockingFixture(fixture) {
    if (typeof fixture.isSensor === "function" && fixture.isSensor()) return false;
    const tag = fixture.getUserData();
    const body = fixture.getBody();
    if (body === this.body || body === this.armBody) return false;
    if (tag === "ground" || tag === "wall") return true;
    if (tag === "playerBody" || tag === "foot") return true;
    return false;
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
        if (!this._isBlockingFixture(fixture)) return -1;
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
        if (!this._isBlockingFixture(fixture)) return -1;
        hit = true;
        return 0;
      });

      return hit;
    };

    return { leftHit: castOne(leftX), rightHit: castOne(rightX) };
  }

  // Fire horizontal rays left and right from two heights on the body midpoint.
  // Returns true if any side ray hits solid geometry.
  // Used exclusively for auto-balance strength — does NOT gate tilt or jump.
  computeSideGroundedByRays() {
    const rayLenM    = this.pxToM(SIDE_RAY_LEN_PX);
    const insetM     = this.pxToM(SIDE_RAY_START_INSET_PX);
    const halfWm     = this.pxToM(PLAYER_HALF_W_PX);
    const startEdgeM = halfWm - insetM;

    for (const yOffPx of SIDE_RAY_Y_OFFSETS_PX) {
      const localY = this.pxToM(yOffPx);

      for (const sideSign of [-1, +1]) {
        const localStart = Vec2(sideSign * startEdgeM, localY);
        const start      = this.body.getWorldPoint(localStart);
        // Shoot horizontally in the body's local X direction (world-rotated)
        const bodyAngle  = this.body.getAngle();
        const worldDirX  = sideSign * Math.cos(bodyAngle);
        const worldDirY  = sideSign * Math.sin(bodyAngle);
        const end        = Vec2(start.x + worldDirX * rayLenM,
                                start.y + worldDirY * rayLenM);

        let hit = false;
        this.world.rayCast(start, end, (fixture) => {
          if (!this._isBlockingFixture(fixture)) return -1;
          hit = true;
          return 0;
        });

        if (hit) return true;
      }
    }

    return false;
  }

  computePDTorqueWrapped(targetAngleRad, kp, kd, maxTorque) {
    const angle = wrapRadPi(this.body.getAngle());
    const angVel = this.body.getAngularVelocity();
    const err = wrapRadPi(targetAngleRad - angle);
    const torque = kp * err - kd * angVel;
    return clamp(torque, -maxTorque, maxTorque);
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

    // Wall clearance: prevent setTransform from embedding player in walls.
    // Cast a horizontal ray from posNow toward posNew; if a wall is hit,
    // clamp posNew.x so the body stays clear by PLAYER_HALF_W_PX.
    const dx = posNew.x - posNow.x;
    if (Math.abs(dx) > EPSILON) {
      const sideSign = Math.sign(dx);
      const clearanceM = this.pxToM(PLAYER_HALF_W_PX + 2);
      const scanLen = Math.abs(dx) + clearanceM;
      const scanEnd = Vec2(posNow.x + sideSign * scanLen, posNow.y);
      let minFrac = 1.0;
      this.world.rayCast(posNow, scanEnd, (fixture, pt, nrm, frac) => {
        if (!this._isBlockingFixture(fixture)) return -1;
        if (frac < minFrac) minFrac = frac;
        return frac;
      });
      if (minFrac < 1.0) {
        const wallX = posNow.x + sideSign * scanLen * minFrac;
        posNew.x = wallX - sideSign * clearanceM;
      }
    }

    this.body.setTransform(posNew, angleTarget);
    this.body.setAngularVelocity(0);

    // Kill both velocity components during tilt: gravity is disabled (setGravityScale 0)
    // so vx/vy should not accumulate; zero both to prevent drift.
    this.body.setLinearVelocity(Vec2(0, 0));

    // keep a notion of which "side" we're leaning to
    if (Math.abs(localXTarget) > EPSILON) this.activePivotSide = localXTarget > 0 ? +1 : -1;
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

  // cachedArmPose: optional pre-computed result of getArmPosePx() to avoid duplicate call
  computeGunPosePx(cachedArmPose = null) {
    if (!this.gunId) return null;
    const def = this.gunCatalog[this.gunId];
    if (!def) return null;

    const armPose = cachedArmPose ?? this.getArmPosePx();
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

    // foot ground grace (gates tilt + jump)
    const rawGrounded = this.computeGroundedByRays();
    if (rawGrounded) this.groundGraceTimer = GROUND_GRACE_TIME_SEC;
    else this.groundGraceTimer = Math.max(0, this.groundGraceTimer - fixedDt);
    this.touchingGround = this.groundGraceTimer > 0;

    // side ground grace (gates auto-balance strength only)
    const rawSideGrounded = this.computeSideGroundedByRays();
    if (rawSideGrounded || rawGrounded) this.sideGroundGraceTimer = GROUND_GRACE_TIME_SEC;
    else this.sideGroundGraceTimer = Math.max(0, this.sideGroundGraceTimer - fixedDt);
    this.touchingAnySurface = this.sideGroundGraceTimer > 0;

    this.justJumpedTimer = Math.max(0, this.justJumpedTimer - fixedDt);

    // dragging disables tilt/balance
    this.updateMouseDrag(input);

    this.updateAutoAim(fixedDt);

    const events = [];

    // ------------------------------------------------------------
    // Guns (server authoritative)
    // fireSeq = press edge (semi-auto); fireHeld = hold (automatic guns only)
    const def = this.gunCatalog[this.gunId] || null;
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
      this._resetTiltState();
      return events;
    }

    if (!input) return events;

    let tiltDir = 0;
    if (input.tiltLeft) tiltDir -= 1;
    if (input.tiltRight) tiltDir += 1;

    const tiltAllowedNow = TILT_ENABLED && this.touchingGround;

    if (!tiltAllowedNow) {
      this.body.setGravityScale(1);
      this._resetTiltState();
    }

    // Release tilt -> jump
    if (tiltAllowedNow && this.prevTiltDir !== 0 && tiltDir === 0) {
      this.body.setGravityScale(1);
      const didJump = this.doTiltReleaseJump();
      this._resetTiltState();
      if (didJump) return events;
    }

    if (tiltAllowedNow && tiltDir !== 0) {
      // Disable gravity while tilting so it doesn't fight setTransform
      this.body.setGravityScale(0);

      const angleNow = wrapRadPi(this.body.getAngle());
      const isTiltStartOrSwitch = this.prevTiltDir === 0 || tiltDir !== this.prevTiltDir;

      // On fresh press / direction switch: if already past max, lock here immediately
      if (isTiltStartOrSwitch) {
        if (Math.abs(angleNow) >= TILT_MAX_ANGLE_RAD) {
          this.holdPastMaxActive = true;
          this.holdPastMaxAngleRad = angleNow;
        } else {
          this.holdPastMaxActive = false;
        }
      }

      const cornerHits = this.computeFootCornerGroundedByRays();

      const leftGroundedNow = cornerHits.leftHit;
      const rightGroundedNow = cornerHits.rightHit;

      if (leftGroundedNow) this.leftCornerGrace = CORNER_GRACE_TIME_SEC;
      else this.leftCornerGrace = Math.max(0, this.leftCornerGrace - fixedDt);

      if (rightGroundedNow) this.rightCornerGrace = CORNER_GRACE_TIME_SEC;
      else this.rightCornerGrace = Math.max(0, this.rightCornerGrace - fixedDt);

      const leftGrounded = this.leftCornerGrace > 0;
      const rightGrounded = this.rightCornerGrace > 0;

      // Compute the desired angle this tick
      // tiltSensitivity 0→0.5x, 0.5→1x, 1→2x speed
      const tiltSpeedMult = 0.5 + this.tiltSensitivity * 1.5;
      // Ramp tilt speed linearly: slow when upright, full speed at max tilt.
      // Speed can only increase during a tilt session — never dips back down
      // (e.g. tilting left-to-right won't slow at 0 degrees).
      const tiltFraction = Math.abs(angleNow) / TILT_MAX_ANGLE_RAD;
      const TILT_MIN_SPEED_FRAC = 0.35;
      const angleRamp = TILT_MIN_SPEED_FRAC + (1 - TILT_MIN_SPEED_FRAC) * clamp(tiltFraction, 0, 1);
      this.tiltRampMult = Math.max(this.tiltRampMult, angleRamp);
      const tiltSpeed = TILT_ROTATE_SPEED_RAD_PER_SEC * tiltSpeedMult * this.tiltRampMult;
      const wantAngle = clamp(tiltDir * TILT_MAX_ANGLE_RAD, -TILT_MAX_ANGLE_RAD, +TILT_MAX_ANGLE_RAD);
      const diff = wrapRadPi(wantAngle - angleNow);
      let step = clamp(diff, -tiltSpeed * fixedDt, +tiltSpeed * fixedDt);
      let angleTarget = wrapRadPi(angleNow + step);

      // Clamp to max and latch the hold flag when we reach it
      const atMax = Math.abs(angleTarget) >= (TILT_MAX_ANGLE_RAD - TILT_PAST_MAX_EPS_RAD);
      // Only latch the max-hold if we haven't already locked (e.g. started past max).
      // If holdPastMaxActive is already true, the locked angle was set on press and
      // must not be overwritten by the atMax check.
      if (atMax && !this.holdPastMaxActive) {
        angleTarget = tiltDir * TILT_MAX_ANGLE_RAD;
        this.holdPastMaxActive = true;
        this.holdPastMaxAngleRad = angleTarget;
      }

      // Enforce the locked angle (started past max, or reached max)
      if (this.holdPastMaxActive) {
        angleTarget = this.holdPastMaxAngleRad;
      }

      this.applyTiltPinnedToFootContact(angleNow, angleTarget, leftGrounded, rightGrounded);

      this.prevTiltDir = tiltDir;

      return events;
    }

    // Ensure gravity is restored any time we reach this non-tilt path
    this.body.setGravityScale(1);

    // Auto-balance when not tilting (reduced in air, suppressed just after jump)
    if (this.prevTiltDir === 0) {
      const targetAngle = 0;

      const mult = (this.justJumpedTimer > 0) ? 0
                 : this.touchingAnySurface    ? 1
                 : AIR_BALANCE_MULT;

      if (mult > 0) {
        const torque = this.computePDTorqueWrapped(
          targetAngle,
          BALANCE_KP * mult,
          BALANCE_KD * mult,
          BALANCE_MAX_TORQUE
        );

        this.body.applyTorque(torque);
      }
    }

    // When !tiltAllowedNow, _resetTiltState() already zeroed prevTiltDir;
    // overwriting here would cause landing to skip the "started past max" check.
    if (tiltAllowedNow) {
      this.prevTiltDir = tiltDir;
    }

    return events;
  }

  // State snapshot for LobbyRoom — arm pose computed once and reused for gun pose.
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

    const gunPose = this.computeGunPosePx(armPose);

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