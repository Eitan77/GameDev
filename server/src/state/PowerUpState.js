import { Schema, defineTypes } from "@colyseus/schema";

export default class PowerUpState extends Schema {
  constructor() {
    super();
    this.type = "";     // gunId like "sniper"
    this.x = 0;
    this.y = 0;
    this.active = true;
  }
}

defineTypes(PowerUpState, {
  type: "string",
  x: "int32",
  y: "int32",
  active: "boolean",
});
