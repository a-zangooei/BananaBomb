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

// --- Optical Morse Side-Lamp & Braille Dial Module Rules Engine ---
export const BEACON_SPECTRUM_COLORS = ['red', 'blue', 'yellow'];

export const BEACON_SPECTRUM_LABELS = {
  red: 'قرمز (Red)',
  blue: 'آبی (Blue)',
  yellow: 'زرد (Yellow)'
};

export const BRAILLE_DIGITS = {
  1: '⠁',
  2: '⠃',
  3: '⠉'
};

export const BEACON_PATTERNS = [
  { id: 'vector', name: 'پالس وکتور (Vector)', patternStr: '·· — ·', beats: [1, 1, 3, 1] },
  { id: 'sigma', name: 'پالس سیگما (Sigma)', patternStr: '— · — ·', beats: [3, 1, 3, 1] },
  { id: 'delta', name: 'پالس دلتا (Delta)', patternStr: '· — — ·', beats: [1, 3, 3, 1] },
  { id: 'omega', name: 'پالس امگا (Omega)', patternStr: '— — · ·', beats: [3, 3, 1, 1] }
];

export const BEACON_SCHEMAS = [
  {
    id: 'alpha',
    protocolName: 'پروتکل آلفا (طیف نوری پایه)',
    colorMaps: {
      red: { vector: 2, sigma: 1, delta: 3, omega: 1 },
      blue: { vector: 1, sigma: 3, delta: 2, omega: 3 },
      yellow: { vector: 3, sigma: 2, delta: 1, omega: 2 }
    },
    evaluate(patternId, spectrumColor = 'red') {
      const map = this.colorMaps[spectrumColor] || this.colorMaps.red;
      return map[patternId] ?? 1;
    }
  },
  {
    id: 'beta',
    protocolName: 'پروتکل بتا (شکست منشوری فاز)',
    colorMaps: {
      red: { vector: 3, sigma: 2, delta: 1, omega: 3 },
      blue: { vector: 2, sigma: 1, delta: 3, omega: 2 },
      yellow: { vector: 1, sigma: 3, delta: 2, omega: 1 }
    },
    evaluate(patternId, spectrumColor = 'red') {
      const map = this.colorMaps[spectrumColor] || this.colorMaps.red;
      return map[patternId] ?? 2;
    }
  },
  {
    id: 'gamma',
    protocolName: 'پروتکل گاما (همگام‌سازی پالس نوری)',
    colorMaps: {
      red: { vector: 1, sigma: 3, delta: 2, omega: 2 },
      blue: { vector: 3, sigma: 2, delta: 1, omega: 1 },
      yellow: { vector: 2, sigma: 1, delta: 3, omega: 3 }
    },
    evaluate(patternId, spectrumColor = 'red') {
      const map = this.colorMaps[spectrumColor] || this.colorMaps.red;
      return map[patternId] ?? 3;
    }
  }
];

export const BEACON_RULES = {
  spectrumColors: BEACON_SPECTRUM_COLORS,
  spectrumLabels: BEACON_SPECTRUM_LABELS,
  brailleDigits: BRAILLE_DIGITS,
  patterns: BEACON_PATTERNS,
  schemas: BEACON_SCHEMAS,
  defaultSchema: BEACON_SCHEMAS[0],
  evaluate(patternId, spectrumColor = 'red', schema = BEACON_SCHEMAS[0]) {
    return schema.evaluate(patternId, spectrumColor);
  }
};

function buildBeaconColorRows(mapObj) {
  return Object.entries(mapObj).map(([patId, ch]) => {
    const pat = BEACON_PATTERNS.find((p) => p.id === patId);
    return {
      id: patId,
      name: pat.name,
      pattern: pat.patternStr,
      channelNum: ch,
      channel: `کانال ${ch}`
    };
  });
}

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
        action: 'یک‌بار ضربه کوتاه و فوری (Tap)'
      })),
      otherRow: {
        condition: 'سایر حالات دکمه',
        action: 'دکمه را نگه‌دار تا ناظر رنگ نوار کناری را ببیند'
      },
      stripRows: Object.entries(buttonSchema.stripDigitMap).map(([color, digit]) => ({
        colorName: color === 'blue' ? 'آبی' : (color === 'yellow' ? 'زرد' : (color === 'white' ? 'سفید' : 'قرمز')),
        digit
      })),
      note: 'ناظر رنگ دکمه، پلاک سریال و نوار کناری را در نمای ۳D می‌بیند و با اشاره‌های توافقی با شما هماهنگ می‌کند؛ شما بدون کلام، نتیجه (ضربه کوتاه یا نگه‌داشتن و رقم ثانیه رهاسازی) را فقط با اشاره به ناظر منتقل کنید تا ناظر شفاهاً به اپراتور فرمان دهد.'
    },
    wires: {
      protocolName: wiresSchema.protocolName,
      checklist: wiresSchema.checklist.map((item, idx) => ({
        step: idx + 1,
        condition: item.desc,
        action: item.targetWire
      })),
      note: 'شماره‌گذاری سیم‌ها از بالا به پایین است (سیم ۱ در بالا تا سیم ۴ در پایین). ناظر چیدمان رنگ سیم‌ها را با اشاره به شما گزارش می‌دهد؛ شماره سیم هدف (۱ تا ۴) را با اشاره به ناظر نشان دهید تا شفاهاً به اپراتور بگوید.'
    },
    keypad: {
      protocolName: keypadSchema.protocolName,
      priorityRibbon: keypadSchema.priorityOrder.join(' ➜ '),
      note: 'ناظر ۴ نماد روی بمب را با اشاره با شما تطبیق می‌دهد؛ ترتیب اولویت از چپ به راست را فقط با اشاره به ناظر منتقل کنید تا ناظر شفاهاً ترتیب کلیدهای ۱ تا ۴ را به اپراتور اعلام نماید.'
    },
    beacon: {
      protocolName: beaconSchema.protocolName,
      brailleLegend: [
        { channel: 1, braille: '⠁', label: 'کانال ۱ (⠁)' },
        { channel: 2, braille: '⠃', label: 'کانال ۲ (⠃)' },
        { channel: 3, braille: '⠉', label: 'کانال ۳ (⠉)' }
      ],
      colorTables: {
        red: buildBeaconColorRows(beaconSchema.colorMaps.red),
        blue: buildBeaconColorRows(beaconSchema.colorMaps.blue),
        yellow: buildBeaconColorRows(beaconSchema.colorMaps.yellow)
      },
      note: 'این ماژول کاملاً بی‌صدا است و هیچ سرنخ صوتی در اتاق پخش نمی‌کند (ناظر نیز نباید از صدای عمومی بازی استفاده کند). اپراتور چشمک‌های لامپ مورس روی دیواره چپ کیف را دیده و ریتم آن را با ضربه روی میز یا اشاره دست به ناظر نشان می‌دهد؛ ناظر رنگ چراغ طیف داخل کیف (قرمز، آبی یا زرد) و ریتم مورس را با اشاره با شما هماهنگ می‌کند و شما شماره کانال هدف (۱ تا ۳) را با اشاره به ناظر اعلام می‌کنید تا اپراتور از روی اعداد بریل پیچ، فرکانس را ارسال نماید.'
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

