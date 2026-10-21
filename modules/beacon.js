import { BEACON_RULES } from './rules-config.js';

/**
 * Server-side Acoustic Beacon Module
 * Operator perceives acoustic rhythm and adjusts dial;
 * Observer observes physical dial state and relays serial number;
 * Manual-holder decrypts target channel from the rhythm matrix.
 */
export const beaconModule = {
  id: 'beacon',
  title: 'فانوس صوتی (Acoustic Beacon)',

  create(rng, ctx) {
    const schema = ctx?.roundRules?.beaconSchema || BEACON_RULES.defaultSchema;
    const pattern = BEACON_RULES.patterns[Math.floor(rng() * BEACON_RULES.patterns.length)];
    const targetChannel = schema.evaluate(pattern.id, ctx?.isSerialEven);

    return {
      id: 'beacon',
      pattern,
      targetChannel,
      tunedChannel: 1,
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;

    const isOperator = role === 'operator' || role === 'blind';
    const isObserver = role === 'observer' || role === 'deaf';

    // Operator hears acoustic telemetry and operates channel dial
    if (isOperator) {
      return {
        id: 'beacon',
        solved: state.solved,
        tunedChannel: state.tunedChannel,
        patternId: state.pattern.id,
        patternName: state.pattern.name,
        patternStr: state.pattern.patternStr,
        beats: state.pattern.beats
        // targetChannel is STRICTLY OMITTED
      };
    }

    // Observer sees physical dial and status light (Silent)
    if (isObserver) {
      return {
        id: 'beacon',
        solved: state.solved,
        tunedChannel: state.tunedChannel
        // pattern, beats, targetChannel are STRICTLY OMITTED
      };
    }

    // Manual-holder (Mute)
    return {
      id: 'beacon',
      solved: state.solved
    };
  },

  handleAction(state, action, data, ctx) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'tune') {
      const channel = parseInt(data?.channel, 10);
      if (channel >= 1 && channel <= 3) {
        state.tunedChannel = channel;
        return { solved: false, strike: false, tunedChannel: channel };
      }
      return { solved: false, strike: false };
    }

    if (action === 'transmit') {
      if (state.tunedChannel === state.targetChannel) {
        state.solved = true;
        return {
          solved: true,
          strike: false,
          reason: `سیگنال فرکانسی روی کانال ${state.targetChannel} قفل شد!`
        };
      }
      return {
        solved: false,
        strike: true,
        reason: `ارسال روی فرکانس نادرست (کانال ${state.tunedChannel}) منجر به خطا شد!`
      };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return Boolean(state?.solved);
  }
};
