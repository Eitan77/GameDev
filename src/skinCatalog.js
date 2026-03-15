// ============================================================
// src/skinCatalog.js
// Skin catalog: maps skinId → { name, tint }.
// Tints are applied at runtime via Phaser setTint() on the
// existing player.png / arm.png sprites — no extra assets.
// ============================================================

export const SKIN_CATALOG = {
  default: { name: "Default",    tint: null },
  crimson: { name: "Crimson",    tint: 0xff4444 },
  ocean:   { name: "Ocean Blue", tint: 0x4488ff },
  forest:  { name: "Forest",     tint: 0x44cc44 },
  royal:   { name: "Royal",      tint: 0x8844ff },
  golden:  { name: "Golden",     tint: 0xffcc00 },
  shadow:  { name: "Shadow",     tint: 0x555555 },
  coral:   { name: "Coral",      tint: 0xff7766 },
  arctic:  { name: "Arctic",     tint: 0xaaddff },
  toxic:   { name: "Toxic",      tint: 0x88ff00 },
};

export const SKIN_IDS = Object.keys(SKIN_CATALOG);
export const DEFAULT_SKIN_ID = "default";

const STORAGE_KEY = "getaway_skinId";

export function loadSkinId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SKIN_CATALOG[stored]) return stored;
  } catch (_) {}
  return DEFAULT_SKIN_ID;
}

export function saveSkinId(skinId) {
  try {
    localStorage.setItem(STORAGE_KEY, skinId);
  } catch (_) {}
}
