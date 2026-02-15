// ============================================================
// player.js (FULL FILE)
// - Owns ONE player: sprite + planck body + foot + arm + controls
// - NOW supports remote players: setNetTargetPose()
// ============================================================

import Phaser from "phaser";
import planck from "planck";

const pl = planck;
const Vec2 = pl.Vec2;

// ============================================================
// CONSTANTS (same as before)
// ============================================================

const PLAYER_ART_FACES_RIGHT = true;

const PLAYER_W_PX = 60;
const PLAYER_H_PX = 180;

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

const MOUSE_GRAB_RADIUS_PX = 140;
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

const PLAYER_DEPTH = 5;
const ARM_DEPTH = 6;

const PLAYER_HALF_W_PX = PLAYER_W_PX / 2;
const PLAYER_HALF_H_PX = PLAYER_H_PX / 2;

const TILT_MAX_ANGLE_RAD = Phaser.Math.DegToRad(TILT_MAX_ANGLE_DEG);
const TILT_ROTATE_SPEED_RAD_PER_SEC = Phaser.Math.DegToRad(TILT_ROTATE_SPEED_DEG_PER_SEC);

// ============================================================
// HELPERS
// ============================================================

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function wrapRadPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function rotateXY(x, y, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: x * c - y * s, y: x * s + y * c };
}

// ============================================================
// PLAYER CLASS
// ============================================================

export default class Player {
  constructor(opts) {
    this.scene = opts.scene;
    this.world = opts.world;
    this.groundBody = opts.groundBody;
    this.ppm = opts.ppm;

    this.playerImageKey = opts.playerImageKey;
    this.armImageKey = opts.armImageKey;

    this.isLocal = opts.isLocal ?? true;

    // Facing dir (+1 right, -1 left)
    this.facingDir = +1;
    this.prevFacingDir = this.facingDir;

    // NET: remote players get target poses from server
    this.netTarget = null;

    // Create sprite
    this.sprite = this.scene.add.image(0, 0, this.playerImageKey);
    this.sprite.setDisplaySize(PLAYER_W_PX, PLAYER_H_PX);
    this.sprite.setOrigin(0.5, 0.5);
    this.sprite.setDepth(PLAYER_DEPTH);

    // Create physics body
    this.body = this.world.createBody({
      type: "dynamic",
      position: Vec2(this.pxToM(opts.startXpx), this.pxToM(opts.startYpx)),
      fixedRotation: false
    });

    this.body
      .createFixture(pl.Box(this.pxToM(PLAYER_HALF_W_PX), this.pxToM(PLAYER_HALF_H_PX)), {
        density: PLAYER_DENSITY,
        friction: PLAYER_FRICTION
      })
      .setUserData("playerBody");

    const footCenterLocal = Vec2(0, this.pxToM(PLAYER_HALF_H_PX - FOOT_HALF_H_PX));

    this.body
      .createFixture(
        pl.Box(this.pxToM(FOOT_HALF_W_PX), this.pxToM(FOOT_HALF_H_PX), footCenterLocal, 0),
        { density: FOOT_DENSITY, friction: FOOT_FRICTION }
      )
      .setUserData("foot");

    this.body.setAngle(Phaser.Math.DegToRad(opts.startAngleDeg));

    this.playerBottomLocalYm = this.pxToM(PLAYER_HALF_H_PX);

    // Arm stuff
    this.arm = null;
    this.armBody = null;
    this.armJoint = null;
    this.armTopLocalM = null;

    this.createSwingArm();

    // Control state
    this.touchingGround = false;
    this.groundGraceTimer = 0;

    this.prevTiltDir = 0;
    this.activePivotSide = 0;

    this.holdPastMaxActive = false;
    this.holdPastMaxAngleRad = 0;

    // Mouse drag
    this.isDragging = false;
    this.mouseJoint = null;
    this.dragTargetPx = { x: opts.startXpx, y: opts.startYpx };

    // Sync now
    this.renderUpdate();
    this.applyFacingToSprites();
  }

  // ==========================================================
  // NET: remote pose updates from server
  // ==========================================================

  setNetTargetPose(xPx, yPx, angleRad, dir) {
    this.netTarget = {
      xPx,
      yPx,
      angleRad,
      dir
    };
  }

  // ==========================================================
  // UNIT CONVERSIONS
  // ==========================================================

  pxToM(px) {
    return px / this.ppm;
  }

  mToPx(m) {
    return m * this.ppm;
  }

  // ==========================================================
  // FACING
  // ==========================================================

  updateFacingFromInput(input) {
    if (!input) return;

    const leftDown = !!input.tiltLeft;
    const rightDown = !!input.tiltRight;

    if (leftDown && !rightDown) this.facingDir = -1;
    else if (rightDown && !leftDown) this.facingDir = +1;

    if (this.facingDir !== this.prevFacingDir) {
      this.prevFacingDir = this.facingDir;
      this.rebuildArmForFacing();
    }
  }

  applyFacingToSprites() {
    const flip = PLAYER_ART_FACES_RIGHT ? this.facingDir === -1 : this.facingDir === +1;
    this.sprite.setFlipX(flip);
    if (this.arm) this.arm.setFlipX(flip);
  }

  rebuildArmForFacing() {
    this.destroySwingArm();
    this.createSwingArm();
    this.applyFacingToSprites();
  }

  // ==========================================================
  // ARM
  // ==========================================================

  destroySwingArm() {
    if (this.armJoint) {
      this.world.destroyJoint(this.armJoint);
      this.armJoint = null;
    }
    if (this.armBody) {
      this.world.destroyBody(this.armBody);
      this.armBody = null;
    }
    if (this.arm) {
      this.arm.destroy();
      this.arm = null;
    }
    this.armTopLocalM = null;
  }

  createSwingArm() {
    this.arm = this.scene.add.image(0, 0, this.armImageKey);
    this.arm.setDisplaySize(ARM_W_PX, ARM_H_PX);
    this.arm.setOrigin(0.5, 0.0);
    this.arm.setDepth(ARM_DEPTH);

    const shoulderLocalXpx = ARM_SHOULDER_LOCAL_X_PX * this.facingDir;
    const shoulderLocalYpx = ARM_SHOULDER_LOCAL_Y_PX;

    const shoulderLocal = Vec2(this.pxToM(shoulderLocalXpx), this.pxToM(shoulderLocalYpx));
    const shoulderWorld = this.body.getWorldPoint(shoulderLocal);

    const armHalfWm = this.pxToM(ARM_W_PX / 2);
    const armHalfHm = this.pxToM(ARM_H_PX / 2);

    this.armTopLocalM = Vec2(0, -armHalfHm);

    const startAngle = this.body.getAngle();
    const topOffsetRot = rotateXY(0, -armHalfHm, startAngle);

    const armCenter = Vec2(
      shoulderWorld.x - topOffsetRot.x,
      shoulderWorld.y - topOffsetRot.y
    );

    this.armBody = this.world.createBody({
      type: "dynamic",
      position: armCenter,
      angle: startAngle,
      fixedRotation: false
    });

    const armFix = this.armBody.createFixture(pl.Box(armHalfWm, armHalfHm), {
      density: ARM_DENSITY,
      friction: 0
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

  // ==========================================================
  // POINTER (local only)
  // ==========================================================

  handlePointerDown(worldX, worldY) {
    if (!this.isLocal) return;
    if (this.isPointerNearPlayer(worldX, worldY)) this.startMouseDrag(worldX, worldY);
  }

  handlePointerMove(worldX, worldY) {
    if (!this.isLocal) return;
    if (!this.isDragging) return;
    this.dragTargetPx.x = worldX;
    this.dragTargetPx.y = worldY;
  }

  handlePointerUp() {
    if (!this.isLocal) return;
    this.endMouseDrag();
  }

  isPointerNearPlayer(worldX, worldY) {
    const dx = worldX - this.sprite.x;
    const dy = worldY - this.sprite.y;
    return dx * dx + dy * dy <= MOUSE_GRAB_RADIUS_PX * MOUSE_GRAB_RADIUS_PX;
  }

  startMouseDrag(worldX, worldY) {
    if (this.isDragging) return;
    this.isDragging = true;

    this.dragTargetPx.x = worldX;
    this.dragTargetPx.y = worldY;

    this.body.setAwake(true);

    this.mouseJoint = this.world.createJoint(
      pl.MouseJoint(
        {
          maxForce: MOUSE_DRAG_MAX_FORCE,
          frequencyHz: MOUSE_DRAG_FREQUENCY_HZ,
          dampingRatio: MOUSE_DRAG_DAMPING_RATIO
        },
        this.groundBody,
        this.body,
        Vec2(this.pxToM(worldX), this.pxToM(worldY))
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

  // ==========================================================
  // GROUNDED RAYCASTS (same as before)
  // ==========================================================

  computeGroundedByRays() {
    const rayLenM = this.pxToM(GROUND_RAY_LEN_PX);
    const localStartYM = this.pxToM(PLAYER_HALF_H_PX - GROUND_RAY_START_INSET_PX);

    let anyHit = false;

    for (let i = 0; i < GROUND_RAY_X_OFFSETS_PX.length; i++) {
      const xOffM = this.pxToM(GROUND_RAY_X_OFFSETS_PX[i]);
      const localPoint = Vec2(xOffM, localStartYM);

      const start = this.body.getWorldPoint(localPoint);
      const end = Vec2(start.x, start.y + rayLenM);

      this.world.rayCast(start, end, (fixture) => {
        const tag = fixture.getUserData();
        if (tag === "playerBody" || tag === "foot") return -1;
        if (tag !== "ground") return -1;
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
        if (tag === "playerBody" || tag === "foot") return -1;
        if (tag !== "ground") return -1;
        hit = true;
        return 0;
      });

      return hit;
    };

    return { leftHit: castOne(leftX), rightHit: castOne(rightX) };
  }

  // ==========================================================
  // BALANCE / TILT HELPERS (same as before)
  // ==========================================================

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

    if (
      this.activePivotSide === +1 &&
      tiltDir === -1 &&
      angleNow > 0 &&
      angleTarget <= 0
    ) {
      pivotSide = -1;
    }

    if (
      this.activePivotSide === -1 &&
      tiltDir === +1 &&
      angleNow < 0 &&
      angleTarget >= 0
    ) {
      pivotSide = +1;
    }

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

    const posPerfect = Vec2(
      pivotWorld.x - rotatedPivot.x,
      pivotWorld.y - rotatedPivot.y
    );

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

  // ==========================================================
  // FIXED UPDATE
  // ==========================================================

  fixedUpdate(input, fixedDt) {
    // --------------------------------------
    // REMOTE PLAYER: follow server netTarget
    // --------------------------------------
    if (!this.isLocal) {
      if (this.netTarget) {
        // Move body to server position
        this.body.setAwake(true);
        this.body.setTransform(
          Vec2(this.pxToM(this.netTarget.xPx), this.pxToM(this.netTarget.yPx)),
          this.netTarget.angleRad
        );

        // Stop drift
        this.body.setLinearVelocity(Vec2(0, 0));
        this.body.setAngularVelocity(0);

        // Update facing from server if provided
        if (this.netTarget.dir === 1 || this.netTarget.dir === -1) {
          this.facingDir = this.netTarget.dir;

          if (this.facingDir !== this.prevFacingDir) {
            this.prevFacingDir = this.facingDir;
            this.rebuildArmForFacing();
          }
        }
      }

      // Remote has no local controls
      return;
    }

    // --------------------------------------
    // LOCAL PLAYER: your original logic
    // --------------------------------------

    const rawGrounded = this.computeGroundedByRays();

    if (rawGrounded) this.groundGraceTimer = GROUND_GRACE_TIME_SEC;
    else this.groundGraceTimer = Math.max(0, this.groundGraceTimer - fixedDt);

    this.touchingGround = this.groundGraceTimer > 0;

    if (this.isDragging && this.mouseJoint) {
      this.mouseJoint.setTarget(
        Vec2(this.pxToM(this.dragTargetPx.x), this.pxToM(this.dragTargetPx.y))
      );
    }

    if (this.isDragging) {
      this.prevTiltDir = 0;
      this.activePivotSide = 0;
      this.holdPastMaxActive = false;
      return;
    }

    if (!input) return;

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
      return;
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
      return;
    }

    this.prevTiltDir = 0;
    this.activePivotSide = 0;
    this.holdPastMaxActive = false;

    const balanceTargetRad = Phaser.Math.DegToRad(BALANCE_TARGET_ANGLE_DEG);
    const strengthMult = this.touchingGround ? 1.0 : AIR_BALANCE_MULT;

    const torque = this.computePDTorqueWrapped(
      balanceTargetRad,
      BALANCE_KP * strengthMult,
      BALANCE_KD * strengthMult,
      BALANCE_MAX_TORQUE
    );

    this.body.applyTorque(torque);
  }

  // ==========================================================
  // RENDER UPDATE
  // ==========================================================

  renderUpdate() {
    const p = this.body.getPosition();
    this.sprite.x = this.mToPx(p.x);
    this.sprite.y = this.mToPx(p.y);
    this.sprite.rotation = this.body.getAngle();

    if (this.armBody && this.arm && this.armTopLocalM) {
      const topWorld = this.armBody.getWorldPoint(this.armTopLocalM);
      this.arm.x = this.mToPx(topWorld.x);
      this.arm.y = this.mToPx(topWorld.y);
      this.arm.rotation = this.armBody.getAngle();
    }
  }

  destroy() {
    this.destroySwingArm();

    if (this.body) {
      this.world.destroyBody(this.body);
      this.body = null;
    }

    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }
  }
}
