// ============================================================
// server/src/rooms/partyLookup.js
//
// Shared maps between PartyRoom and the Express /party/lookup
// endpoint. Imported by both modules to avoid circular deps.
// ============================================================

/** @type {Map<string, string>} partyCode -> roomId */
export const activeParties = new Map();

/** @type {Map<string, string>} roomId -> partyCode */
export const partyCodesByRoom = new Map();
