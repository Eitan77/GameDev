import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import PlayerState from "./PlayerState.js";
import PowerUpState from "./PowerUpState.js";

export default class LobbyState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.powerUps = new MapSchema();
  }
}

defineTypes(LobbyState, {
  players: { map: PlayerState },
  powerUps: { map: PowerUpState },
});
