/**
 * Module Utilities
 */

/**
 * Unbiased Fisher-Yates (Knuth) Shuffle using a provided PRNG.
 * @template T
 * @param {T[]} array
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
