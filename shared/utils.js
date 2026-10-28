/**
 * Isomorphic Pure Utilities: Seeded PRNG, Fisher-Yates Shuffle, Serial Generator & Braille Constants.
 */

export const BRAILLE_DIGITS = Object.freeze({
  1: '⠁',
  2: '⠃',
  3: '⠉'
});

// Standard 6-dot Braille active dot indices (1-based: 1=top-left, 2=mid-left, 3=bot-left, 4=top-right, 5=mid-right, 6=bot-right)
export const BRAILLE_DOT_MAP = Object.freeze({
  1: Object.freeze([1]),
  2: Object.freeze([1, 2]),
  3: Object.freeze([1, 4])
});

export function isPlainObject(v) {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Deterministic FNV-1a + shift-mix PRNG producing [0, 1) floats.
 */
export function createRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  return function () {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    return ((h += h << 5) >>> 0) / 4294967296;
  };
}

export function generateRandomSeed() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function generateSerialNumber(rng) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';
  return `${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}-${digits[Math.floor(rng() * digits.length)]}${digits[Math.floor(rng() * digits.length)]}-${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}`;
}

/**
 * Unbiased Fisher-Yates (Knuth) Shuffle using a provided PRNG.
 * @template T
 * @param {readonly T[]} array
 * @param {() => number} rng
 * @returns {T[]} A new shuffled array
 */
export function fisherYatesShuffle(array, rng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
