// ============================================================
// server/src/sim/PlayerSim.js
// Server-side Planck simulation for one player.
// ✅ Gun pose + muzzle + forward + raycast EXACTLY like old client code.
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

const TILT_MAX_ANGLE_RAD = (TILT_MAX_ANGLE_DEG * Math.PI) / 180;
const TILT_ROTATE_SPEED_RAD_PER_SEC = (TILT_ROTATE_SPEED_DEG_PER_SEC * Math.PI) / 180;

// defaults if missing
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

    this.touchingGround = false;
    this.groundGraceTimer = 0;

    this.prevTiltDir = 0;
    this.activePivotSide = 0;

    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

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

  createBody(startXpx, startYpx) {
    this.body = this.world.createBody({
      type: "dynamic",
      position: Vec2(this.pxToM(startXpx), this.pxToM(startYpx)),
      fixedRotation: false,
    });

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

  destroy() {
    this.endMouseDrag();
    this.destroySwingArm();
    if (this.body) {
      this.world.destroyBody(this.body);
      this.body = null;
    }
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

  // --------------------------
  // Tilt / balance
  // --------------------------
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
    const clampedAng = clamp(angleNow, -TILT_MAX_ANGLE_RAD, +TILT_MAX_ANGLE_RAD);

    const jumpSpeedMps = this.pxToM(JUMP_SPEED_PX_PER_SEC);
    const vx = Math.sin(clampedAng) * jumpSpeedMps;
    const vy = -Math.cos(clampedAng) * jumpSpeedMps;

    this.body.setLinearVelocity(Vec2(vx, vy));
    this.body.setAngularVelocity(0);

    this.groundGraceTimer = 0;
    this.touchingGround = false;
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
    return true;
  }

  dropGun() { this.gunId = ""; this.ammo = 0; }

  // --------------------------
  // Arm pose (top point)
  // --------------------------
  getArmPosePx() {
    if (!this.armBody || !this.armTopLocalM) return null;
    const topWorld = this.armBody.getWorldPoint(this.armTopLocalM);
    return {
      armX: this.mToPx(topWorld.x),
      armY: this.mToPx(topWorld.y),
      armA: this.armBody.getAngle(),
    };
  }

  // --------------------------
  // ✅ EXACT gun pose math like old client updateGunSpriteTransform()
  // --------------------------
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

  // ✅ EXACT muzzle world point like old client computeGunMuzzleWorldPx()
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

  // ✅ EXACT forward direction like old getGunForwardUnit()
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

  // ✅ EXACT raycast like old raycastBeamEndPx()
  raycastBeamEndPx(startPx, dirUnit, maxDistPx) {
    const startM = Vec2(this.pxToM(startPx.x), this.pxToM(startPx.y));
    const endPx = { x: startPx.x + dirUnit.x * maxDistPx, y: startPx.y + dirUnit.y * maxDistPx };
    const endM = Vec2(this.pxToM(endPx.x), this.pxToM(endPx.y));

    let bestFraction = 1.0;
    let bestPointM = null;

    this.world.rayCast(startM, endM, (fixture, point, _normal, fraction) => {
      if (!fixture) return -1;

      if (typeof fixture.isSensor === "function" && fixture.isSensor()) return -1;

      const body = fixture.getBody();
      if (body === this.body || body === this.armBody) return -1;

      if (fraction < bestFraction) {
        bestFraction = fraction;
        bestPointM = point;
      }

      return fraction;
    });

    if (bestPointM) return { x: this.mToPx(bestPointM.x), y: this.mToPx(bestPointM.y) };
    return endPx;
  }

  // Called by LobbyRoom each tick BEFORE world.step
  applyInput(input, fixedDt) {
    // facing from input
    if (input) {
      const leftDown = !!input.tiltLeft;
      const rightDown = !!input.tiltRight;

      if (leftDown && !rightDown) this.facingDir = -1;
      else if (rightDown && !leftDown) this.facingDir = +1;

      if (this.facingDir !== this.prevFacingDir) {
        this.prevFacingDir = this.facingDir;
        this.rebuildArmForFacing();
      }
    }

    // ground grace
    const rawGrounded = this.computeGroundedByRays();
    if (rawGrounded) this.groundGraceTimer = GROUND_GRACE_TIME_SEC;
    else this.groundGraceTimer = Math.max(0, this.groundGraceTimer - fixedDt);
    this.touchingGround = this.groundGraceTimer > 0;

    // dragging disables tilt/balance
    this.updateMouseDrag(input);

    const events = [];

    // fireSeq -> authoritative shot trigger
    const fireSeq = Number(input?.fireSeq) | 0;
    if (fireSeq !== this.lastFireSeq) {
      this.lastFireSeq = fireSeq;

      const def = this.gunCatalog?.[this.gunId];
      if (def && this.ammo > 0 && def.bulletEnabled) {
        // consume ammo
        this.ammo = Math.max(0, (this.ammo - 1) | 0);

        const muzzle = this.computeGunMuzzleWorldPx();
        const dir = this.getGunForwardUnit();

        if (muzzle && dir) {
          const maxDistPx = Math.max(10, Number(def.bulletMaxDistancePx ?? 2200));
          const endPx = this.raycastBeamEndPx(muzzle, dir, maxDistPx);

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

          // fire sound
          if (def.fireSoundKey) {
            events.push({
              kind: "sound",
              key: def.fireSoundKey,
              volume: Number(def.fireSoundVolume ?? 1),
              rate: Number(def.fireSoundRate ?? 1),
            });
          }

          // reload sound only if NOT last bullet
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

        // drop gun when ammo hits 0 (old behavior)
        if (this.ammo <= 0) {
          this.dropGun();
        }
      }
    }

    if (this.isDragging) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
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
    }

    if (tiltAllowedNow && this.prevTiltDir !== 0 && tiltDir === 0) {
      this.doTiltReleaseJump();
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      return events;
    }

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

  // After world.step, use this snapshot for state
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

      // optional debug (client doesn't need these, but harmless)
      gunX: gunPose ? Math.round(gunPose.gunX) : 0,
      gunY: gunPose ? Math.round(gunPose.gunY) : 0,
      gunA: gunPose ? gunPose.gunA : 0,
    };
  }
}
