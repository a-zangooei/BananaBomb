/**
 * Central Authoritative Difficulty Presets & Error Penalty Configuration
 * BananaBomb Cooperative Bomb Defusal Engine
 *
 * NOTE ON BALANCE VALUES (PROVISIONAL):
 * All timer durations, error budgets (maxStrikes), scaled time penalties (-15s / -30s / -45s),
 * module counts, and interaction grace windows defined below are starting baseline values,
 * NOT finalized balance constants. Tune these parameters exclusively in this file based on
 * empirical telemetry from physical 3-player local playtests.
 */

export const DIFFICULTY_PRESETS = {
  easy: {
    id: 'easy',
    name: 'آسان (Easy)',
    duration: 300,          // 5 minutes
    maxStrikes: 3,          // 3 allowed errors before explosion
    moduleCount: 2,         // 2 active modules (Wires + Button/Beacon)
    timePenaltySeconds: 15, // -15s per error
    interactionGraceMs: 150,// Forgiving interaction cooldown
    features: {
      wireIndexLabels: true, // Observer sees visual numbered wire indicators (1..4)
      timerGraceSeconds: 30, // Initial +30s grace period (Total: 330s)
      commAidEnabled: true,  // Optional Easy-mode 3-symbol communication aid
      commAidBudget: 5       // Starting budget of 5 uses per round
    }
  },
  normal: {
    id: 'normal',
    name: 'متوسط (Normal)',
    duration: 300,          // 5 minutes
    maxStrikes: 3,          // 3 allowed errors
    moduleCount: 3,         // 3 active modules
    timePenaltySeconds: 30, // -30s per error
    interactionGraceMs: 70, // Standard interaction cooldown
    features: {
      wireIndexLabels: false,
      timerGraceSeconds: 0,
      commAidEnabled: false,
      commAidBudget: 0
    }
  },
  hard: {
    id: 'hard',
    name: 'سخت (Hard)',
    duration: 210,          // 3.5 minutes (210s)
    maxStrikes: 2,          // Only 2 allowed errors (1 error before critical)
    moduleCount: 4,         // All 4 modules active
    timePenaltySeconds: 45, // -45s per error
    interactionGraceMs: 50, // Demanding interaction timing
    features: {
      wireIndexLabels: false,
      timerGraceSeconds: 0,
      commAidEnabled: false,
      commAidBudget: 0
    }
  }
};

export const DEFAULT_DIFFICULTY_ID = 'normal';

/**
 * Validates and sanitizes difficulty configuration from host payload
 */
export function sanitizeDifficultyConfig(presetId, customOverrides = null) {
  const basePreset = DIFFICULTY_PRESETS[presetId] || DIFFICULTY_PRESETS[DEFAULT_DIFFICULTY_ID];

  if (!customOverrides || typeof customOverrides !== 'object') {
    return {
      preset: basePreset.id,
      name: basePreset.name,
      duration: basePreset.duration,
      maxStrikes: basePreset.maxStrikes,
      moduleCount: basePreset.moduleCount,
      timePenaltySeconds: basePreset.timePenaltySeconds,
      interactionGraceMs: basePreset.interactionGraceMs,
      features: { ...basePreset.features }
    };
  }

  // Sanitize custom overrides within safe authoritative bounds
  const rawDuration = customOverrides.duration !== undefined ? parseInt(customOverrides.duration, 10) : basePreset.duration;
  const rawMaxStrikes = customOverrides.maxStrikes !== undefined ? parseInt(customOverrides.maxStrikes, 10) : basePreset.maxStrikes;
  const rawModuleCount = customOverrides.moduleCount !== undefined ? parseInt(customOverrides.moduleCount, 10) : basePreset.moduleCount;
  const rawPenalty = customOverrides.timePenaltySeconds !== undefined ? parseInt(customOverrides.timePenaltySeconds, 10) : basePreset.timePenaltySeconds;
  const rawGrace = customOverrides.interactionGraceMs !== undefined ? parseInt(customOverrides.interactionGraceMs, 10) : basePreset.interactionGraceMs;

  const duration = Math.min(600, Math.max(60, isNaN(rawDuration) ? basePreset.duration : rawDuration));
  const maxStrikes = Math.min(5, Math.max(1, isNaN(rawMaxStrikes) ? basePreset.maxStrikes : rawMaxStrikes));
  const moduleCount = Math.min(4, Math.max(2, isNaN(rawModuleCount) ? basePreset.moduleCount : rawModuleCount));
  const timePenaltySeconds = Math.min(90, Math.max(0, isNaN(rawPenalty) ? basePreset.timePenaltySeconds : rawPenalty));
  const interactionGraceMs = Math.min(300, Math.max(30, isNaN(rawGrace) ? basePreset.interactionGraceMs : rawGrace));

  const commAidEnabled = customOverrides.features?.commAidEnabled !== undefined
    ? Boolean(customOverrides.features.commAidEnabled)
    : Boolean(basePreset.features.commAidEnabled);

  let commAidBudget = basePreset.features.commAidBudget || 0;
  if (customOverrides.features?.commAidBudget !== undefined) {
    const parsedBudget = parseInt(customOverrides.features.commAidBudget, 10);
    commAidBudget = isNaN(parsedBudget) ? (commAidEnabled ? 5 : 0) : Math.min(15, Math.max(0, parsedBudget));
  } else if (commAidEnabled && commAidBudget === 0) {
    commAidBudget = 5;
  }
  if (!commAidEnabled) {
    commAidBudget = 0;
  }

  return {
    preset: basePreset.id,
    isCustom: true,
    name: `${basePreset.name} (سفارشی)`,
    duration,
    maxStrikes,
    moduleCount,
    timePenaltySeconds,
    interactionGraceMs,
    features: {
      wireIndexLabels: customOverrides.features?.wireIndexLabels !== undefined
        ? Boolean(customOverrides.features.wireIndexLabels)
        : basePreset.features.wireIndexLabels,
      timerGraceSeconds: customOverrides.features?.timerGraceSeconds !== undefined
        ? Math.max(0, parseInt(customOverrides.features.timerGraceSeconds, 10) || 0)
        : basePreset.features.timerGraceSeconds,
      commAidEnabled: commAidEnabled && commAidBudget > 0,
      commAidBudget
    }
  };
}

/**
 * Mathematical Expected Value Analysis for Guessing Strategy
 */
export function analyzeGuessingCost(moduleType, difficultyConfig) {
  const penalty = difficultyConfig.timePenaltySeconds;
  const strikesLeft = difficultyConfig.maxStrikes;
  
  // Single-guess probabilities of success
  const probabilities = {
    wires: 0.25,        // 1 of 4 wires
    button_tap: 0.5,    // tap vs hold
    button_release: 0.1,// 1 of 10 timer digits
    keypad_single: 0.25,// 1 of 4 initial keys
    keypad_full: 1 / 24,// 4! = 24 permutations (~4.16%)
    beacon: 1 / 3       // 1 of 3 channels (~33.3%)
  };

  const prob = probabilities[moduleType] || 0.25;
  const failProb = 1 - prob;
  
  // Expected time cost: failProb * penalty (rounded to 4 decimal places)
  const expectedTimeLoss = Math.round(failProb * penalty * 10000) / 10000;
  // Strike exhaustion risk fraction
  const strikeRiskFraction = Math.round((1 / strikesLeft) * 10000) / 10000;

  return {
    moduleType,
    successProbability: prob,
    failProbability: failProb,
    expectedTimeLoss,
    strikeRiskFraction,
    isGuessingDominant: expectedTimeLoss < 10 && prob > 0.6
  };
}
