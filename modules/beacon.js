import { BEACON_RULES } from './rules-config.js';
import { isOperatorRole, isObserverRole } from '../shared/roles.js';
import { fisherYatesShuffle, isPlainObject } from '../shared/utils.js';

/**
 * Server-side Silent Optical Morse Side-Lamp & Tactile Braille Dial Module
 * - Operator sees the West-side Optical Morse lamp flashes (`beats`) and tactile Braille
 *   channel numbers (`slotChannels`: permutation of [1, 2, 3]) around the selector dial.
 * - Observer sees the Spectrum Color Indicator lamp (`spectrumColor`: 'red' | 'blue' | 'yellow')
 *   and physical dial slot position (`tunedSlot`), without Braille digits or Morse flashes.
 * - Manual-holder decodes `(pattern × spectrumColor) -> targetChannel` from the round rulebook.
 */
export const beaconModule = {
  id: 'beacon',
  title: 'فانوس مورس نوری (Optical Morse)',

  create(rng, ctx) {
    const schema = ctx?.roundRules?.beaconSchema || BEACON_RULES.defaultSchema;
    const pattern = BEACON_RULES.patterns[Math.floor(rng() * BEACON_RULES.patterns.length)];
    const colors = BEACON_RULES.spectrumColors;
    const spectrumColor = colors[Math.floor(rng() * colors.length)];

    // Deterministic Fisher-Yates shuffle of [1, 2, 3] across the 3 physical dial slots (1..3)
    const slotChannels = fisherYatesShuffle([1, 2, 3], rng);

    const tunedSlot = 1;
    const tunedChannel = slotChannels[tunedSlot - 1];
    const targetChannel = schema.evaluate(pattern.id, spectrumColor);

    return {
      id: 'beacon',
      pattern,
      spectrumColor,
      slotChannels,
      tunedSlot,
      tunedChannel,
      targetChannel,
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;

    // Operator sees West-side Optical Morse flashes + Braille channel labels on dial slots;
    // spectrumColor and targetChannel are STRICTLY OMITTED.
    if (isOperatorRole(role)) {
      return {
        id: 'beacon',
        solved: state.solved,
        tunedSlot: state.tunedSlot,
        tunedChannel: state.tunedChannel,
        slotChannels: [...state.slotChannels],
        patternId: state.pattern.id,
        patternName: state.pattern.name,
        patternStr: state.pattern.patternStr,
        beats: [...state.pattern.beats]
      };
    }

    // Observer sees colored Spectrum Indicator lamp + physical needle slot (1..3);
    // beats, pattern, Braille slotChannels, tunedChannel, and targetChannel are STRICTLY OMITTED.
    if (isObserverRole(role)) {
      return {
        id: 'beacon',
        solved: state.solved,
        tunedSlot: state.tunedSlot,
        spectrumColor: state.spectrumColor
      };
    }

    // Manual-holder (Mute) receives solved flag only (rules live in roundManual.beacon)
    return {
      id: 'beacon',
      solved: state.solved
    };
  },

  validateAction(action, rawData) {
    if (action === 'tune') {
      if (isPlainObject(rawData) && Number.isInteger(rawData.slot) && rawData.slot >= 1 && rawData.slot <= 3) {
        return { ok: true, sanitizedData: { slot: rawData.slot }, targetKey: `tune_slot_${rawData.slot}` };
      }
      if (isPlainObject(rawData) && Number.isInteger(rawData.channel) && rawData.channel >= 1 && rawData.channel <= 3) {
        return { ok: true, sanitizedData: { channel: rawData.channel }, targetKey: `tune_ch_${rawData.channel}` };
      }
      return { ok: false, message: 'جایگاه یا شماره کانال فانوس مورس نوری نامعتبر است (باید ۱، ۲ یا ۳ باشد).' };
    }
    if (action === 'transmit') {
      return { ok: true, sanitizedData: {}, targetKey: 'tx' };
    }
    return { ok: false, message: 'نوع عملیات ماژول فانوس مورس نوری نامعتبر است.' };
  },

  handleAction(state, action, data) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'tune') {
      const slot = Number.isInteger(data?.slot) ? data.slot : parseInt(data?.slot, 10);
      if (slot >= 1 && slot <= 3) {
        state.tunedSlot = slot;
        state.tunedChannel = state.slotChannels[slot - 1];
        return {
          solved: false,
          strike: false,
          tunedSlot: state.tunedSlot,
          tunedChannel: state.tunedChannel
        };
      }

      const channel = Number.isInteger(data?.channel) ? data.channel : parseInt(data?.channel, 10);
      if (channel >= 1 && channel <= 3) {
        const foundIdx = Array.isArray(state.slotChannels) ? state.slotChannels.indexOf(channel) : -1;
        state.tunedSlot = foundIdx !== -1 ? foundIdx + 1 : channel;
        state.tunedChannel = channel;
        return {
          solved: false,
          strike: false,
          tunedSlot: state.tunedSlot,
          tunedChannel: state.tunedChannel
        };
      }

      return { solved: false, strike: false };
    }

    if (action === 'transmit') {
      const activeChannel =
        Array.isArray(state.slotChannels) && state.tunedSlot >= 1 && state.tunedSlot <= 3
          ? state.slotChannels[state.tunedSlot - 1]
          : state.tunedChannel;
      state.tunedChannel = activeChannel;

      if (activeChannel === state.targetChannel) {
        state.solved = true;
        return {
          solved: true,
          strike: false,
          reason: `سیگنال مورس نوری روی کانال ${state.targetChannel} قفل و خنثی شد!`
        };
      }
      return {
        solved: false,
        strike: true,
        reason: `ارسال روی فرکانس نادرست (کانال بریل ${activeChannel}) منجر به خطا شد!`
      };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return Boolean(state?.solved);
  }
};
