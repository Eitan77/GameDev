import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import PlayerState from "./PlayerState.js";
import PowerUpState from "./PowerUpState.js";

export default class LobbyState extends Schema {
  constructor() {
    super();

    this.players = new MapSchema();
    this.powerUps = new MapSchema();

    // ------------------------------------------------------------
    // Round timer (server authoritative)
    // - roundDurationSec: constant duration for this match (ex: 120)
    // - roundTimeLeftSec: seconds remaining (counts down to 0)
    // ------------------------------------------------------------
    this.roundDurationSec = 0;
    this.roundTimeLeftSec = 0;
  }
}

defineTypes(LobbyState, {
  players: { map: PlayerState },
  powerUps: { map: PowerUpState },

  roundDurationSec: "uint16",
  roundTimeLeftSec: "uint16",
});