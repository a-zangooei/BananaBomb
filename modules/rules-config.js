/**
 * Authoritative Single Source of Truth for BOMBANANA / BananaBomb Module Rules
 * Supports robust seed-based dynamic rule generation across rounds.
 */

// --- Button Module Rules Engine ---
export const BUTTON_SCHEMAS = [
  {
    id: 'alpha',
    protocolName: 'پروتکل آلفا (کاتالیزور حرارتی)',
    tapRules: [
      { color: 'white', serialCondition: 'any', desc: 'دکمه سفید (در هر حالتی)' },
      { color: 'red', serialCondition: 'odd', desc: 'دکمه قرمز اگر رقم آخر سریال فرد باشد' }
    ],
    otherAction: 'hold',
    stripDigitMap: {
      blue: 4,
      yellow: 5,
      white: 1,
      red: 7
    },
    evaluate(color, holdStripColor, isSerialEven) {
      if (color === 'white') return { actionType: 'press', targetReleaseDigit: null };
      if (color === 'red' && !isSerialEven) return { actionType: 'press', targetReleaseDigit: null };
      return {
        actionType: 'hold',
        targetReleaseDigit: this.stripDigitMap[holdStripColor] ?? 1
      };
    }
  },
  {
    id: 'beta',
    protocolName: 'پروتکل بتا (تخلیه فرکانسی)',
    tapRules: [
      { color: 'yellow', serialCondition: 'any', desc: 'دکمه زرد (در هر حالتی)' },
      { color: 'blue', serialCondition: 'even', desc: 'دکمه آبی اگر رقم آخر سریال زوج باشد' }
    ],
    otherAction: 'hold',
    stripDigitMap: {
      red: 3,
      blue: 6,
      white: 8,
      yellow: 2
    },
    evaluate(color, holdStripColor, isSerialEven) {
      if (color === 'yellow') return { actionType: 'press', targetReleaseDigit: null };
      if (color === 'blue' && isSerialEven) return { actionType: 'press', targetReleaseDigit: null };
      return {
        actionType: 'hold',
        targetReleaseDigit: this.stripDigitMap[holdStripColor] ?? 3
      };
    }
  },
  {
    id: 'gamma',
    protocolName: 'پروتکل گاما (ماتریس کوانتومی)',
    tapRules: [
      { color: 'red', serialCondition: 'any', desc: 'دکمه قرمز (در هر حالتی)' },
      { color: 'white', serialCondition: 'even', desc: 'دکمه سفید اگر رقم آخر سریال زوج باشد' }
    ],
    otherAction: 'hold',
    stripDigitMap: {
      yellow: 1,
      red: 5,
      blue: 9,
      white: 4
    },
    evaluate(color, holdStripColor, isSerialEven) {
      if (color === 'red') return { actionType: 'press', targetReleaseDigit: null };
      if (color === 'white' && isSerialEven) return { actionType: 'press', targetReleaseDigit: null };
      return {
        actionType: 'hold',
        targetReleaseDigit: this.stripDigitMap[holdStripColor] ?? 1
      };
    }
  }
];

export const BUTTON_RULES = {
  colors: ['white', 'red', 'blue', 'yellow'],
  stripColors: ['blue', 'yellow', 'white', 'red'],
  tapHoldThresholdMs: 350,
  schemas: BUTTON_SCHEMAS,
  defaultSchema: BUTTON_SCHEMAS[0],
  stripDigitMap: BUTTON_SCHEMAS[0].stripDigitMap,
  evaluate(color, holdStripColor, isSerialEven, schema = BUTTON_SCHEMAS[0]) {
    return schema.evaluate(color, holdStripColor, isSerialEven);
  }
};

// --- Wires Module Rules Engine ---
export const WIRES_SCHEMAS = [
  {
    id: 'alpha',
    protocolName: 'پروتکل آلفا (توالی جریان پیوسته)',
    checklist: [
      { desc: 'اگر بیش از یک سیم قرمز وجود دارد:', targetWire: 'سیم دوم (۲)' },
      { desc: 'در غیر این‌صورت، اگر آخرین سیم زرد است:', targetWire: 'سیم اول (۱)' },
      { desc: 'در غیر این‌صورت، اگر دقیقاً یک سیم آبی وجود دارد:', targetWire: 'سیم سوم (۳)' },
      { desc: 'در سایر حالات:', targetWire: 'سیم چهارم (۴)' }
    ],
    evaluate(wires) {
      const redCount = wires.filter((c) => c === 'red').length;
      const blueCount = wires.filter((c) => c === 'blue').length;
      if (redCount > 1) return 1;
      if (wires[3] === 'yellow') return 0;
      if (blueCount === 1) return 2;
      return 3;
    }
  },
  {
    id: 'beta',
    protocolName: 'پروتکل بتا (انشعاب اتصال زمین)',
    checklist: [
      { desc: 'اگر هیچ سیم قرمزی وجود ندارد:', targetWire: 'سیم اول (۱)' },
      { desc: 'در غیر این‌صورت، اگر بیش از یک سیم سبز وجود دارد:', targetWire: 'سیم چهارم (۴)' },
      { desc: 'در غیر این‌صورت، اگر آخرین سیم قرمز است:', targetWire: 'سیم دوم (۲)' },
      { desc: 'در سایر حالات:', targetWire: 'سیم سوم (۳)' }
    ],
    evaluate(wires) {
      const redCount = wires.filter((c) => c === 'red').length;
      const greenCount = wires.filter((c) => c === 'green').length;
      if (redCount === 0) return 0;
      if (greenCount > 1) return 3;
      if (wires[3] === 'red') return 1;
      return 2;
    }
  },
  {
    id: 'gamma',
    protocolName: 'پروتکل گاما (توزیع گذرگاه دوگانه)',
    checklist: [
      { desc: 'اگر بیش از یک سیم آبی وجود دارد:', targetWire: 'سیم سوم (۳)' },
      { desc: 'در غیر این‌صورت، اگر اولین سیم سبز است:', targetWire: 'سیم دوم (۲)' },
      { desc: 'در غیر این‌صورت، اگر بیش از یک سیم زرد وجود دارد:', targetWire: 'سیم چهارم (۴)' },
      { desc: 'در سایر حالات:', targetWire: 'سیم اول (۱)' }
    ],
    evaluate(wires) {
      const blueCount = wires.filter((c) => c === 'blue').length;
      const yellowCount = wires.filter((c) => c === 'yellow').length;
      if (blueCount > 1) return 2;
      if (wires[0] === 'green') return 1;
      if (yellowCount > 1) return 3;
      return 0;
    }
  }
];

export const WIRES_RULES = {
  colors: ['red', 'blue', 'yellow', 'green'],
  schemas: WIRES_SCHEMAS,
  defaultSchema: WIRES_SCHEMAS[0],
  evaluate(wires, schema = WIRES_SCHEMAS[0]) {
    return schema.evaluate(wires);
  }
};

// --- Keypad Module Rules Engine ---
export const KEYPAD_SCHEMAS = [
  {
    id: 'alpha',
    protocolName: 'کدگذاری آلفا (ترتیب استاندارد کیهانی)',
    priorityOrder: ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙']
  },
  {
    id: 'beta',
    protocolName: 'کدگذاری بتا (ترتیب معکوس صنعتی)',
    priorityOrder: ['⚙', 'Ψ', '✦', '⚡', '★', '◆', 'Ω', '▲']
  },
  {
    id: 'gamma',
    protocolName: 'کدگذاری گاما (ترتیب هندسی کوانتومی)',
    priorityOrder: ['▲', 'Ω', '◆', '⚙', 'Ψ', '★', '⚡', '✦']
  }
];

export const KEYPAD_RULES = {
  symbolPool: ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'],
  schemas: KEYPAD_SCHEMAS,
  defaultSchema: KEYPAD_SCHEMAS[0],
  evaluate(symbols, priorityOrder = KEYPAD_SCHEMAS[0].priorityOrder) {
    return [...symbols].sort(
      (a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b)
    );
  }
};

// --- Acoustic Beacon Module Rules Engine ---
export const BEACON_PATTERNS = [
  { id: 'vector', name: 'پالس وکتور (Vector)', patternStr: '·· — ·', beats: [1, 1, 3, 1] },
  { id: 'sigma', name: 'پالس سیگما (Sigma)', patternStr: '— · — ·', beats: [3, 1, 3, 1] },
  { id: 'delta', name: 'پالس دلتا (Delta)', patternStr: '· — — ·', beats: [1, 3, 3, 1] },
  { id: 'omega', name: 'پالس امگا (Omega)', patternStr: '— — · ·', beats: [3, 3, 1, 1] }
];

export const BEACON_SCHEMAS = [
  {
    id: 'alpha',
    protocolName: 'پروتکل آلفا (کالیبراسیون فرکانس پایه)',
    evenMap: { vector: 2, sigma: 1, delta: 3, omega: 1 },
    oddMap: { vector: 1, sigma: 3, delta: 2, omega: 3 },
    evaluate(patternId, isSerialEven) {
      const map = isSerialEven ? this.evenMap : this.oddMap;
      return map[patternId] ?? 1;
    }
  },
  {
    id: 'beta',
    protocolName: 'پروتکل بتا (انعکاس فاز معکوس)',
    evenMap: { vector: 3, sigma: 2, delta: 1, omega: 2 },
    oddMap: { vector: 2, sigma: 1, delta: 3, omega: 1 },
    evaluate(patternId, isSerialEven) {
      const map = isSerialEven ? this.evenMap : this.oddMap;
      return map[patternId] ?? 2;
    }
  },
  {
    id: 'gamma',
    protocolName: 'پروتکل گاما (مالتی‌پلاکس تشدید موج)',
    evenMap: { vector: 1, sigma: 3, delta: 2, omega: 3 },
    oddMap: { vector: 3, sigma: 2, delta: 1, omega: 2 },
    evaluate(patternId, isSerialEven) {
      const map = isSerialEven ? this.evenMap : this.oddMap;
      return map[patternId] ?? 3;
    }
  }
];

export const BEACON_RULES = {
  patterns: BEACON_PATTERNS,
  schemas: BEACON_SCHEMAS,
  defaultSchema: BEACON_SCHEMAS[0],
  evaluate(patternId, isSerialEven, schema = BEACON_SCHEMAS[0]) {
    return schema.evaluate(patternId, isSerialEven);
  }
};

/**
 * Selects round rules deterministically based on the round PRNG and seed,
 * generating the complete structured rulebook for the manual-holder.
 */
export function selectRoundRules(rng, seed = 'DEFAULT') {
  const buttonIdx = Math.floor(rng() * BUTTON_SCHEMAS.length);
  const wiresIdx = Math.floor(rng() * WIRES_SCHEMAS.length);
  const keypadIdx = Math.floor(rng() * KEYPAD_SCHEMAS.length);
  const beaconIdx = Math.floor(rng() * BEACON_SCHEMAS.length);

  const buttonSchema = BUTTON_SCHEMAS[buttonIdx];
  const wiresSchema = WIRES_SCHEMAS[wiresIdx];
  const keypadSchema = KEYPAD_SCHEMAS[keypadIdx];
  const beaconSchema = BEACON_SCHEMAS[beaconIdx];

  const rulebook = {
    seed,
    generatedAt: Date.now(),
    button: {
      protocolName: buttonSchema.protocolName,
      tapRows: buttonSchema.tapRules.map((r) => ({
        condition: r.desc,
        action: 'یک‌بار کلیک سریع و فوری (Tap)'
      })),
      otherRow: {
        condition: 'سایر حالات دکمه',
        action: 'دکمه را نگه‌دار و نوار رنگی کناری را بخوان'
      },
      stripRows: Object.entries(buttonSchema.stripDigitMap).map(([color, digit]) => ({
        colorName: color === 'blue' ? 'آبی' : (color === 'yellow' ? 'زرد' : (color === 'white' ? 'سفید' : 'قرمز')),
        digit
      })),
      note: 'ناظر رنگ دکمه و نوار کناری را می‌بیند؛ شما پس از بررسی شرایط بالا به اپراتور کلیک یا زمان رهاسازی را بگویید.'
    },
    wires: {
      protocolName: wiresSchema.protocolName,
      checklist: wiresSchema.checklist.map((item, idx) => ({
        step: idx + 1,
        condition: item.desc,
        action: item.targetWire
      })),
      note: 'شماره‌گذاری سیم‌ها از بالا به پایین است (سیم ۱ در بالا، سیم ۴ در پایین).'
    },
    keypad: {
      protocolName: keypadSchema.protocolName,
      priorityRibbon: keypadSchema.priorityOrder.join(' ➜ '),
      note: 'از بین ۴ نمادی که ناظر گزارش می‌دهد، اپراتور باید نمادها را از چپ به راست طبق روبان اولویت بالا لمس کند.'
    },
    beacon: {
      protocolName: beaconSchema.protocolName,
      frequencies: [
        { channel: 1, label: 'کانال ۱ (100 MHz)' },
        { channel: 2, label: 'کانال ۲ (250 MHz)' },
        { channel: 3, label: 'کانال ۳ (400 MHz)' }
      ],
      evenRows: Object.entries(beaconSchema.evenMap).map(([patId, ch]) => {
        const pat = BEACON_PATTERNS.find((p) => p.id === patId);
        return { name: pat.name, pattern: pat.patternStr, channel: `کانال ${ch}` };
      }),
      oddRows: Object.entries(beaconSchema.oddMap).map(([patId, ch]) => {
        const pat = BEACON_PATTERNS.find((p) => p.id === patId);
        return { name: pat.name, pattern: pat.patternStr, channel: `کانال ${ch}` };
      }),
      note: 'تنها اپراتور الگوی ریتمیک بیپ را می‌شنود و با ضربه روی میز به ناظر منتقل می‌کند. ناظر بر اساس پلاک و راهنمای شما، شماره کانال را اعلام کرده و اپراتور سلکتور را تنظیم و کلید ارسال را می‌زند.'
    }
  };

  return {
    seed,
    buttonSchema,
    wiresSchema,
    keypadSchema,
    beaconSchema,
    rulebook
  };
}

