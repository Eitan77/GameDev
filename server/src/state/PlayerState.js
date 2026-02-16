import { Schema, defineTypes } from "@colyseus/schema";

export default class PlayerState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.a = 0;

    this.armX = 0;
    this.armY = 0;
    this.armA = 0;

    this.dir = 1;

    this.gunId = "";
    this.ammo = 0;

    // health (server authoritative)
    this.maxHealth = 100;
    this.health = 100;

    // optional debug
    this.gunX = 0;
    this.gunY = 0;
    this.gunA = 0;
  }
}

defineTypes(PlayerState, {
  x: "int32",
  y: "int32",
  a: "float32",

  armX: "int32",
  armY: "int32",
  armA: "float32",

  dir: "int8",

  gunId: "string",
  ammo: "uint8",

  maxHealth: "uint16",
  health: "uint16",

  gunX: "int32",
  gunY: "int32",
  gunA: "float32",
});
