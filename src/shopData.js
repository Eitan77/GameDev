// ============================================================
// src/shopData.js
// Client-side shop persistence (localStorage).
// Stores coin balance and unlocked skin set.
// ============================================================

const COINS_KEY    = "getaway_coins";
const UNLOCKED_KEY = "getaway_unlockedSkins";

const DEFAULT_COINS    = 100;
const DEFAULT_UNLOCKED = ["default"];

// ---- Coins ----

export function loadCoins() {
  try {
    const raw = localStorage.getItem(COINS_KEY);
    if (raw !== null) {
      const val = parseInt(raw, 10);
      if (Number.isFinite(val) && val >= 0) return val;
    }
  } catch (_) {}
  return DEFAULT_COINS;
}

export function saveCoins(amount) {
  try {
    localStorage.setItem(COINS_KEY, String(Math.max(0, amount | 0)));
  } catch (_) {}
}

export function addCoins(amount) {
  const current = loadCoins();
  const updated = current + Math.max(0, amount | 0);
  saveCoins(updated);
  return updated;
}

// ---- Unlocked skins ----

export function loadUnlockedSkins() {
  try {
    const raw = localStorage.getItem(UNLOCKED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const set = new Set(parsed);
        set.add("default"); // default is always unlocked
        return [...set];
      }
    }
  } catch (_) {}
  return [...DEFAULT_UNLOCKED];
}

export function saveUnlockedSkins(skinIds) {
  try {
    const set = new Set(skinIds);
    set.add("default");
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

export function isSkinUnlocked(skinId) {
  return loadUnlockedSkins().includes(skinId);
}

/**
 * Attempt to purchase a skin. Returns true if successful.
 * Deducts coins and adds the skin to the unlocked set.
 */
export function purchaseSkin(skinId, price) {
  const coins = loadCoins();
  if (coins < price) return false;
  saveCoins(coins - price);
  const unlocked = loadUnlockedSkins();
  if (!unlocked.includes(skinId)) {
    unlocked.push(skinId);
    saveUnlockedSkins(unlocked);
  }
  return true;
}

export const COINS_PER_GAME = 10;
