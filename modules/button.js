/**
 * Server-side Reactor Button Module
 */
export const buttonModule = {
  id: 'button',
  title: 'دکمه کاتالیزور',

  create(rng, ctx) {
    const buttonColors = ['red', 'blue', 'yellow', 'white'];
    const buttonLabels = ['خنثی‌سازی', 'نگه‌دار', 'انفجار', 'هشدار'];
    const stripColors = ['yellow', 'blue', 'white'];

    const color = buttonColors[Math.floor(rng() * buttonColors.length)];
    const label = buttonLabels[Math.floor(rng() * buttonLabels.length)];
    const holdStripColor = stripColors[Math.floor(rng() * stripColors.length)];

    let actionType = 'hold';
    let targetReleaseDigit = 1;

    if (color === 'white') {
      actionType = 'press';
      targetReleaseDigit = null;
    } else if (color === 'red' && !ctx.isSerialEven) {
      actionType = 'press';
      targetReleaseDigit = null;
    } else if (color === 'blue') {
      actionType = 'hold';
      targetReleaseDigit = 4;
    } else if (color === 'yellow') {
      actionType = 'hold';
      targetReleaseDigit = 7;
    } else {
      actionType = 'hold';
      targetReleaseDigit = 1;
    }

    return {
      id: 'button',
      color,
      label,
      holdStripColor,
      actionType,
      targetReleaseDigit,
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;
    // NEVER leak actionType or targetReleaseDigit
    if (role === 'blind') {
      return {
        id: 'button',
        solved: state.solved,
        label: 'دکمه',
        color: 'monochrome',
        holdStripColor: state.solved ? null : 'monochrome'
      };
    }
    if (role === 'deaf') {
      return {
        id: 'button',
        solved: state.solved,
        label: state.label,
        color: state.color,
        holdStripColor: state.holdStripColor
      };
    }
    // mute
    return {
      id: 'button',
      solved: state.solved
    };
  },

  handleAction(state, action, data, ctx) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'press') {
      if (state.actionType === 'press') {
        state.solved = true;
        return { solved: true, strike: false, reason: 'دکمه کاتالیزور با موفقیت فشرده شد!' };
      }
      return { solved: false, strike: true, reason: 'فشار ناگهانی روی دکمه در حالتی که نیاز به نگه‌داشتن بود!' };
    }

    if (action === 'release') {
      const rawDigit = data?.releaseDigit !== undefined ? data.releaseDigit : ctx?.lastDigit;
      const releaseDigit = parseInt(rawDigit, 10);
      if (state.actionType === 'hold') {
        if (!isNaN(releaseDigit) && releaseDigit === state.targetReleaseDigit) {
          state.solved = true;
          return {
            solved: true,
            strike: false,
            reason: `دکمه در ثانیه با رقم ${state.targetReleaseDigit} با موفقیت رها شد!`
          };
        }
        return { solved: false, strike: true, reason: `رهاسازی دکمه در ثانیه‌ی اشتباه!` };
      }
      return { solved: false, strike: true, reason: 'نگه‌داشتن دکمه در حالتی که نیاز به فشردن سریع بود!' };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return !!state?.solved;
  }
};
