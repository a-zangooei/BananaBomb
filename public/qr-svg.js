/**
 * Offline ISO/IEC 18004 QR Code Matrix & Crisp Vector SVG Generator
 * Zero external dependencies — works 100% offline over LAN / Hotspot / Termux.
 *
 * Supports Byte mode (UTF-8) across Versions 1..6 (Error Correction Level L, up to 134 bytes),
 * automatic optimal mask selection (0..7) using standard penalty rules, and crisp single-path SVG output.
 */

// Version specifications for Error Correction Level L (Versions 1..6)
// [version]: { size, totalCodewords, ecCodewordsPerBlock, numBlocks, alignmentCenters }
const QR_VERSION_SPECS_L = {
  1: { size: 21, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1, alignment: [] },
  2: { size: 25, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1, alignment: [6, 18] },
  3: { size: 29, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1, alignment: [6, 22] },
  4: { size: 33, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1, alignment: [6, 26] },
  5: { size: 37, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1, alignment: [6, 30] },
  6: { size: 41, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2, alignment: [6, 34] }
};

// GF(256) log / exp tables for primitive polynomial 0x11D (x^8 + x^4 + x^3 + x^2 + 1)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildReedSolomonGenerator(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly; // length = degree + 1, leading coeff poly[0] === 1
}

function computeReedSolomonRemainder(dataBytes, ecDegree) {
  const gen = buildReedSolomonGenerator(ecDegree);
  const rem = new Uint8Array(ecDegree);

  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecDegree - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecDegree; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(text ?? ''));
  }
  const str = String(text ?? '');
  const out = [];
  for (let i = 0; i < str.length; i++) {
    out.push(str.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

function selectVersionForLength(byteLength) {
  for (let v = 1; v <= 6; v++) {
    const spec = QR_VERSION_SPECS_L[v];
    const dataCodewords = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.numBlocks;
    // Byte mode header in V1..9 uses 4-bit mode (0100) + 8-bit length = 12 bits -> max bytes = dataCodewords - 2
    if (byteLength <= dataCodewords - 2) {
      return v;
    }
  }
  throw new Error('QR payload exceeds maximum offline capacity (134 bytes).');
}

function encodeDataCodewords(payloadBytes, spec) {
  const dataCodewordsCount = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.numBlocks;
  const totalDataBits = dataCodewordsCount * 8;
  const bits = [];

  const pushBits = (val, width) => {
    for (let i = width - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator: Byte mode = 0100
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for V1..9)
  pushBits(payloadBytes.length, 8);
  // Data bytes
  for (let i = 0; i < payloadBytes.length; i++) {
    pushBits(payloadBytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const terminatorLen = Math.min(4, totalDataBits - bits.length);
  pushBits(0, terminatorLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad remaining codewords alternating 0xEC and 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalDataBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const codewords = new Uint8Array(dataCodewordsCount);
  for (let i = 0; i < dataCodewordsCount; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bits[i * 8 + b];
    }
    codewords[i] = byteVal;
  }
  return codewords;
}

function buildFinalCodewords(dataCodewords, spec) {
  if (spec.numBlocks === 1) {
    const ec = computeReedSolomonRemainder(dataCodewords, spec.ecCodewordsPerBlock);
    const combined = new Uint8Array(spec.totalCodewords);
    combined.set(dataCodewords, 0);
    combined.set(ec, dataCodewords.length);
    return combined;
  }

  // Multi-block interleaving (used by Version 6: 2 equal blocks)
  const blockDataLen = dataCodewords.length / spec.numBlocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < spec.numBlocks; b++) {
    const slice = dataCodewords.subarray(b * blockDataLen, (b + 1) * blockDataLen);
    dataBlocks.push(slice);
    ecBlocks.push(computeReedSolomonRemainder(slice, spec.ecCodewordsPerBlock));
  }

  const result = new Uint8Array(spec.totalCodewords);
  let offset = 0;
  for (let i = 0; i < blockDataLen; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      result[offset++] = dataBlocks[b][i];
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      result[offset++] = ecBlocks[b][i];
    }
  }
  return result;
}

function createEmptyGrid(size) {
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size));
  return { modules, isFunction };
}

function setFunctionModule(grid, row, col, isDark) {
  const size = grid.modules.length;
  if (row < 0 || row >= size || col < 0 || col >= size) return;
  grid.modules[row][col] = isDark ? 1 : 0;
  grid.isFunction[row][col] = 1;
}

function drawFinderPattern(grid, topRow, leftCol) {
  // Draw 7x7 finder + 1-module white separator border (-1..7)
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = topRow + dr;
      const c = leftCol + dc;
      const inOuterSeparator = dr === -1 || dr === 7 || dc === -1 || dc === 7;
      const inOuterRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCenter3x3 = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      const isDark = !inOuterSeparator && (inOuterRing || inCenter3x3);
      setFunctionModule(grid, r, c, isDark);
    }
  }
}

function drawAlignmentPattern(grid, centerRow, centerCol) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      setFunctionModule(grid, centerRow + dr, centerCol + dc, dist !== 1);
    }
  }
}

function drawFunctionPatterns(grid, spec) {
  const size = spec.size;

  // 1. Three corner finder patterns + separators
  drawFinderPattern(grid, 0, 0);
  drawFinderPattern(grid, 0, size - 7);
  drawFinderPattern(grid, size - 7, 0);

  // 2. Timing patterns along row 6 and col 6
  for (let i = 8; i < size - 8; i++) {
    const isDark = i % 2 === 0;
    setFunctionModule(grid, 6, i, isDark);
    setFunctionModule(grid, i, 6, isDark);
  }

  // 3. Alignment patterns (skipping corners that overlap finder patterns)
  const coords = spec.alignment;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      const r = coords[i];
      const c = coords[j];
      const overlapsFinder =
        (i === 0 && j === 0) ||
        (i === 0 && j === coords.length - 1) ||
        (i === coords.length - 1 && j === 0);
      if (!overlapsFinder) {
        drawAlignmentPattern(grid, r, c);
      }
    }
  }

  // 4. Reserve Format Information modules + fixed Dark Module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(grid, 8, i, false);
      setFunctionModule(grid, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(grid, 8, size - 1 - i, false);
  }
  for (let i = 0; i < 7; i++) {
    setFunctionModule(grid, size - 1 - i, 8, false);
  }
  // Fixed dark module at (row = size - 8, col = 8)
  setFunctionModule(grid, size - 8, 8, true);
}

function placeCodewordsZigZag(grid, codewords) {
  const size = grid.modules.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) {
      rightCol = 5; // Skip vertical timing column
    }
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const col = rightCol - dx;
        if (!grid.isFunction[row][col]) {
          let dark = 0;
          if (bitIdx < totalBits) {
            const byteVal = codewords[bitIdx >>> 3];
            dark = (byteVal >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          grid.modules[row][col] = dark;
        }
      }
    }
    upward = !upward;
  }
}

function shouldInvertForMask(maskIndex, row, col) {
  switch (maskIndex) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return ((((row * col) % 2) + ((row * col) % 3)) % 2) === 0;
    case 7: return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
    default: return false;
  }
}

function computeFormatBitsLevelL(maskIndex) {
  // ECC Level L indicator = 01 (1)
  const data = (0b01 << 3) | (maskIndex & 0b111);
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >>> bit) & 1) {
      rem ^= 0x537 << (bit - 10);
    }
  }
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function writeFormatBits(modules, maskIndex) {
  const size = modules.length;
  const formatBits = computeFormatBitsLevelL(maskIndex);
  const getBit = (idx) => (formatBits >>> idx) & 1;

  // Copy 1: around top-left finder
  const tlRowCoords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = tlRowCoords[i];
    modules[r][c] = getBit(14 - i);
  }

  // Copy 2: bottom-left vertical (bits 14..8) + top-right horizontal (bits 7..0)
  for (let i = 0; i < 7; i++) {
    modules[size - 1 - i][8] = getBit(14 - i);
  }
  for (let i = 0; i < 8; i++) {
    modules[8][size - 8 + i] = getBit(7 - i);
  }
  // Ensure dark module stays set
  modules[size - 8][8] = 1;
}

function computeMaskPenalty(modules) {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: Runs of >= 5 identical modules in rows and columns
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of identical modules
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (modules[r][c + 1] === v && modules[r + 1][c] === v && modules[r + 1][c + 1] === v) {
        penalty += 3;
      }
    }
  }

  // Rule 4: Dark/light balance deviation from 50%
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) darkCount++;
    }
  }
  const total = size * size;
  const fivePercentSteps = Math.floor((Math.abs(darkCount * 20 - total * 10) + total - 1) / total) - 1;
  if (fivePercentSteps > 0) {
    penalty += fivePercentSteps * 10;
  }

  return penalty;
}

/**
 * Encodes text into a square 2D boolean/number matrix representing a scannable QR code.
 */
export function encodeQrMatrix(text) {
  const bytes = utf8Bytes(text);
  if (bytes.length === 0) {
    throw new Error('QR text cannot be empty.');
  }
  const version = selectVersionForLength(bytes.length);
  const spec = QR_VERSION_SPECS_L[version];
  const dataCodewords = encodeDataCodewords(bytes, spec);
  const allCodewords = buildFinalCodewords(dataCodewords, spec);

  const baseGrid = createEmptyGrid(spec.size);
  drawFunctionPatterns(baseGrid, spec);
  placeCodewordsZigZag(baseGrid, allCodewords);

  let bestMatrix = null;
  let bestMask = 0;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseGrid.modules.map((row, r) => {
      const cloned = new Uint8Array(row);
      for (let c = 0; c < spec.size; c++) {
        if (!baseGrid.isFunction[r][c] && shouldInvertForMask(mask, r, c)) {
          cloned[c] ^= 1;
        }
      }
      return cloned;
    });
    writeFormatBits(candidate, mask);
    const penalty = computeMaskPenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return {
    version,
    size: spec.size,
    mask: bestMask,
    modules: bestMatrix
  };
}

/**
 * Renders a crisp vector SVG string with standard 4-module quiet zone.
 */
export function renderQrSvg(text, options = {}) {
  const { size, modules } = encodeQrMatrix(text);
  const margin = Number.isInteger(options.margin) ? options.margin : 4;
  const darkColor = options.darkColor || '#121110';
  const lightColor = options.lightColor || '#fafaf9';
  const viewBoxSize = size + margin * 2;

  const pathSegments = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        pathSegments.push(`M${c + margin},${r + margin}h1v1h-1z`);
      }
    }
  }

  const label = String(options.ariaLabel || 'QR Code').replace(/"/g, '&quot;');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges" role="img" aria-label="${label}">`,
    `<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${lightColor}"/>`,
    `<path d="${pathSegments.join('')}" fill="${darkColor}"/>`,
    `</svg>`
  ].join('');
}
