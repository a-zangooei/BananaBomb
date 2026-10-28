/**
 * Backward-compatible re-export entry for difficulty presets & configuration helpers.
 * Canonical definitions reside in `/shared/difficulty.js` so both server and browser share them.
 */
export {
  DIFFICULTY_PRESETS,
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig,
  hasCustomDifficultyOverrides,
  analyzeGuessingCost
} from '../shared/difficulty.js';
