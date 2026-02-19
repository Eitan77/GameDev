import { Schema, defineTypes } from "@colyseus/schema";

export default class PlayerState extends Schema {
  constructor() {
    super();

    // ------------------------
    // Main body pose
    // ------------------------
    this.x = 0;
    this.y = 0;
    this.a = 0;

    // ------------------------
    // Arm pose (top-anchored)
    // ------------------------
    this.armX = 0;
    this.armY = 0;
    this.armA = 0;

    // ------------------------
    // Facing direction
    // ------------------------
    this.dir = 1;

    // ------------------------
    // Weapon
    // ------------------------
    this.gunId = "";
    this.ammo = 0;

    // ------------------------
    // Health (server authoritative)
    // ------------------------
    this.maxHealth = 100;
    this.health = 100;

    // ------------------------
    // Death / ragdoll flag
    // ------------------------
    this.dead = false;

    // ------------------------
    // Optional debug gun pose
    // ------------------------
    this.gunX = 0;
    this.gunY = 0;
    this.gunA = 0;
  }
}

defineTypes(PlayerState, {
  // body
  x: "int32",
  y: "int32",
  a: "float32",

  // arm
  armX: "int32",
  armY: "int32",
  armA: "float32",

  // direction
  dir: "int8",

  // weapon
  gunId: "string",
  ammo: "uint8",

  // health
  maxHealth: "uint16",
  health: "uint16",

  // death
  dead: "boolean",

  // debug gun pose
  gunX: "int32",
  gunY: "int32",
  gunA: "float32",
});
