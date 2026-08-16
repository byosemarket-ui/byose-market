/**
 * Compact QR Code SVG generator (byte mode, error correction M, versions 1–7).
 * Used for invoice verification links. Does not encode customer PII.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}());

function gfMul(a, b) {
  if (!a || !b) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, eccCount) {
  const gen = rsGenerator(eccCount);
  const ecc = new Array(eccCount).fill(0);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    if (!factor) continue;
    for (let j = 0; j < gen.length - 1; j += 1) {
      ecc[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return ecc;
}

// ECC-M: equal-sized blocks only (versions 1–7).
const VERSION_M = {
  1: { size: 21, ecc: 10, blocks: 1, data: 16, align: [] },
  2: { size: 25, ecc: 16, blocks: 1, data: 28, align: [18] },
  3: { size: 29, ecc: 26, blocks: 1, data: 44, align: [22] },
  4: { size: 33, ecc: 18, blocks: 2, data: 64, align: [26] },
  5: { size: 37, ecc: 24, blocks: 2, data: 86, align: [30] },
  6: { size: 41, ecc: 16, blocks: 4, data: 108, align: [34] },
  7: { size: 45, ecc: 18, blocks: 4, data: 124, align: [22, 38] }
};

function chooseVersion(byteLength) {
  for (let version = 1; version <= 7; version += 1) {
    const spec = VERSION_M[version];
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    const capacity = spec.data * 8;
    if (headerBits + byteLength * 8 + 4 <= capacity) {
      return version;
    }
  }
  return 0;
}

function setModule(grid, size, x, y, value, reserved) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  grid[y * size + x] = value ? 1 : 0;
  if (reserved) reserved[y * size + x] = 1;
}

function addFinder(grid, reserved, size, ox, oy) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const xx = ox + x;
      const yy = oy + y;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      const on = x === -1 || y === -1 || x === 7 || y === 7
        ? 0
        : x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      setModule(grid, size, xx, yy, on, reserved);
    }
  }
}

function addAlignment(grid, reserved, size, cx, cy) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const on = x === -2 || y === -2 || x === 2 || y === 2 || (x === 0 && y === 0);
      setModule(grid, size, cx + x, cy + y, on, reserved);
    }
  }
}

function addTimingAndDark(grid, reserved, size) {
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6 * size + i]) setModule(grid, size, i, 6, i % 2 === 0, reserved);
    if (!reserved[i * size + 6]) setModule(grid, size, 6, i, i % 2 === 0, reserved);
  }
  setModule(grid, size, 8, size - 8, 1, reserved);
}

function reserveFormat(reserved, size) {
  for (let i = 0; i < 9; i += 1) {
    reserved[8 * size + i] = 1;
    reserved[i * size + 8] = 1;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8 * size + (size - 1 - i)] = 1;
    reserved[(size - 1 - i) * size + 8] = 1;
  }
  reserved[8 * size + 8] = 1;
}

function bchFormat(data) {
  let bits = data << 10;
  let poly = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if ((bits >>> i) & 1) bits ^= poly << (i - 10);
  }
  return ((data << 10) | bits) ^ 0x5412;
}

function bchVersion(data) {
  let bits = data << 12;
  const poly = 0x1f25;
  for (let i = 17; i >= 12; i -= 1) {
    if ((bits >>> i) & 1) bits ^= poly << (i - 12);
  }
  return (data << 12) | bits;
}

function placeVersionInfo(grid, reserved, size, version) {
  if (version < 7) return;
  const bits = bchVersion(version);
  let bit = 0;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const on = (bits >> bit) & 1;
      setModule(grid, size, i, size - 11 + j, on, reserved);
      setModule(grid, size, size - 11 + j, i, on, reserved);
      bit += 1;
    }
  }
}

function placeFormat(grid, size, mask) {
  const bits = bchFormat((0b00 << 3) | mask);
  const positions = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  const positions2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8], [size - 8, 8],
    [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4],
    [8, size - 3], [8, size - 2], [8, size - 1]
  ];
  for (let i = 0; i < 15; i += 1) {
    const on = (bits >> i) & 1;
    grid[positions[i][1] * size + positions[i][0]] = on;
    grid[positions2[i][1] * size + positions2[i][0]] = on;
  }
}

function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function buildDataCodewords(text, version) {
  const spec = VERSION_M[version];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  const capacity = spec.data * 8;
  const remain = capacity - bits.length;
  push(0, Math.min(4, Math.max(0, remain)));
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.data) {
    codewords.push(pads[padIndex % 2]);
    padIndex += 1;
  }
  return codewords.slice(0, spec.data);
}

function interleave(data, spec) {
  const blockDataLen = spec.data / spec.blocks;
  const blocks = [];
  for (let i = 0; i < spec.blocks; i += 1) {
    const slice = data.slice(i * blockDataLen, (i + 1) * blockDataLen);
    blocks.push({ data: slice, ecc: rsEncode(slice, spec.ecc) });
  }
  const out = [];
  for (let i = 0; i < blockDataLen; i += 1) {
    blocks.forEach((block) => out.push(block.data[i]));
  }
  for (let i = 0; i < spec.ecc; i += 1) {
    blocks.forEach((block) => out.push(block.ecc[i]));
  }
  return out;
}

function placeData(grid, reserved, size, codewords, mask) {
  const bits = [];
  codewords.forEach((word) => {
    for (let i = 7; i >= 0; i -= 1) bits.push((word >>> i) & 1);
  });
  let bitIndex = 0;
  let direction = -1;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x -= 1;
    for (let i = 0; i < size; i += 1) {
      const y = direction < 0 ? size - 1 - i : i;
      for (let dx = 0; dx < 2; dx += 1) {
        const xx = x - dx;
        if (reserved[y * size + xx]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
        const masked = maskFn(mask, xx, y) ? bit ^ 1 : bit;
        grid[y * size + xx] = masked;
      }
    }
    direction *= -1;
  }
}

function penalty(grid, size) {
  let score = 0;
  const at = (x, y) => grid[y * size + x];

  for (let y = 0; y < size; y += 1) {
    let run = 1;
    for (let x = 1; x < size; x += 1) {
      if (at(x, y) === at(x - 1, y)) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let x = 0; x < size; x += 1) {
    let run = 1;
    for (let y = 1; y < size; y += 1) {
      if (at(x, y) === at(x, y - 1)) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) score += 3;
    }
  }

  const finder = [1, 0, 1, 1, 1, 0, 1];
  const matches = (seq, start) => finder.every((bit, i) => seq[start + i] === bit);
  for (let y = 0; y < size; y += 1) {
    const row = [];
    for (let x = 0; x < size; x += 1) row.push(at(x, y));
    for (let x = 0; x <= size - 7; x += 1) {
      if (matches(row, x)) score += 40;
    }
  }
  for (let x = 0; x < size; x += 1) {
    const col = [];
    for (let y = 0; y < size; y += 1) col.push(at(x, y));
    for (let y = 0; y <= size - 7; y += 1) {
      if (matches(col, y)) score += 40;
    }
  }

  let dark = 0;
  for (let i = 0; i < grid.length; i += 1) dark += grid[i];
  score += Math.abs((dark * 100) / grid.length - 50) / 5 * 10;
  return score;
}

function buildMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  if (!version) return null;
  const spec = VERSION_M[version];
  const size = spec.size;
  const data = interleave(buildDataCodewords(text, version), spec);

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = new Uint8Array(size * size);
    const reserved = new Uint8Array(size * size);
    addFinder(grid, reserved, size, 0, 0);
    addFinder(grid, reserved, size, size - 7, 0);
    addFinder(grid, reserved, size, 0, size - 7);
    const alignPositions = spec.align.length ? [6, ...spec.align] : [];
    alignPositions.forEach((row) => {
      alignPositions.forEach((col) => {
        if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) return;
        addAlignment(grid, reserved, size, col, row);
      });
    });
    addTimingAndDark(grid, reserved, size);
    reserveFormat(reserved, size);
    placeVersionInfo(grid, reserved, size, version);
    placeData(grid, reserved, size, data, mask);
    placeFormat(grid, size, mask);
    const score = penalty(grid, size);
    if (score < bestScore) {
      bestScore = score;
      best = { grid, size };
    }
  }
  return best;
}

export function buildQrSvg(text, { size = 168, margin = 4 } = {}) {
  const payload = String(text || "").trim();
  if (!payload) return "";
  const matrix = buildMatrix(payload);
  if (!matrix) return "";
  const { grid, size: modules } = matrix;
  const total = modules + margin * 2;
  const rects = [];
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (!grid[y * modules + x]) continue;
      rects.push(`<rect x="${(x + margin).toFixed(2)}" y="${(y + margin).toFixed(2)}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${Number(size)}" height="${Number(size)}" role="img" aria-label="Invoice verification QR code" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#10261c">${rects.join("")}</g></svg>`;
}
