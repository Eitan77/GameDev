// ============================================================
// src/skinCatalog.js
// Skin catalog: maps skinId → { name, tint, price }.
// Tints are applied at runtime via Phaser setTint() on the
// existing player.png / arm.png sprites — no extra assets.
// Price is in coins — 0 means always free / unlocked.
// ============================================================

import { isSkinUnlocked } from "./shopData.js";

export const SKIN_CATALOG = {
  default: { name: "Default",    tint: null,     price: 0  },
  crimson: { name: "Crimson",    tint: 0xff4444, price: 50 },
  ocean:   { name: "Ocean Blue", tint: 0x4488ff, price: 50 },
  forest:  { name: "Forest",     tint: 0x44cc44, price: 50 },
  royal:   { name: "Royal",      tint: 0x8844ff, price: 50 },
  golden:  { name: "Golden",     tint: 0xffcc00, price: 50 },
  shadow:  { name: "Shadow",     tint: 0x555555, price: 50 },
  coral:   { name: "Coral",      tint: 0xff7766, price: 50 },
  arctic:  { name: "Arctic",     tint: 0xaaddff, price: 50 },
  toxic:   { name: "Toxic",      tint: 0x88ff00, price: 50 },
};

export const SKIN_IDS = Object.keys(SKIN_CATALOG);
export const DEFAULT_SKIN_ID = "default";

const STORAGE_KEY = "getaway_skinId";

export function loadSkinId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SKIN_CATALOG[stored] && isSkinUnlocked(stored)) return stored;
  } catch (_) {}
  return DEFAULT_SKIN_ID;
}

export function saveSkinId(skinId) {
  try {
    localStorage.setItem(STORAGE_KEY, skinId);
  } catch (_) {}
}
