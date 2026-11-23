import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '../public/icons');

// CRC32 table for PNG chunk checksums
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Geometry helpers in normalized [0, 1] icon coordinates
function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

function rotatePoint(px, py, cx, cy, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Stylized chess knight silhouette in card-local [0, 1] coordinates
const KNIGHT_HEAD_POLY = [
  [0.41, 0.70],
  [0.64, 0.70],
  [0.64, 0.62],
  [0.61, 0.53],
  [0.57, 0.45],
  [0.61, 0.41],
  [0.63, 0.35],
  [0.58, 0.31],
  [0.54, 0.25],
  [0.48, 0.22],
  [0.46, 0.17],
  [0.42, 0.22],
  [0.36, 0.26],
  [0.31, 0.34],
  [0.30, 0.40],
  [0.37, 0.42],
  [0.43, 0.39],
  [0.45, 0.43],
  [0.44, 0.50],
  [0.39, 0.57],
  [0.39, 0.65],
];

function blendOver(dst, r, g, b, a) {
  if (a <= 0) return dst;
  const inv = 1 - a;
  return [
    r * a + dst[0] * inv,
    g * a + dst[1] * inv,
    b * a + dst[2] * inv,
    a + dst[3] * inv,
  ];
}

function sampleIconPixel(nx, ny, options) {
  const { roundedMask, safeScale } = options;

  // Background gradient (#0f172a -> #0b1120)
  const gradT = Math.max(0, Math.min(1, (nx + ny) * 0.5));
  const bgR = 15 + (11 - 15) * gradT;
  const bgG = 23 + (17 - 23) * gradT;
  const bgB = 42 + (32 - 42) * gradT;

  let color = [bgR, bgG, bgB, 1];

  if (roundedMask) {
    const dOuter = sdRoundedRect(nx, ny, 0.5, 0.5, 0.5, 0.5, 0.21);
    if (dOuter > 0) {
      return [0, 0, 0, 0];
    }
  }

  // Transform coordinates for maskable safe-zone inset (80% safe zone -> scale ~0.78)
  const ux = (nx - 0.5) / safeScale + 0.5;
  const uy = (ny - 0.5) / safeScale + 0.5;

  // 1. Back tilted card (Equal / sky outline)
  const [bx, by] = rotatePoint(ux, uy, 0.42, 0.51, (8 * Math.PI) / 180);
  const dBack = sdRoundedRect(bx, by, 0.42, 0.51, 0.275, 0.33, 0.09);
  if (dBack <= 0) {
    color = blendOver(color, 30, 41, 59, 0.95);
    if (dBack > -0.018) {
      color = blendOver(color, 56, 189, 248, 0.55);
    }
  }

  // 2. Front tilted card (Slate card + border + subtle checkerboard)
  const [fx, fy] = rotatePoint(ux, uy, 0.53, 0.50, (-4 * Math.PI) / 180);
  const dFront = sdRoundedRect(fx, fy, 0.53, 0.50, 0.29, 0.35, 0.10);
  if (dFront <= 0) {
    const cardGrad = Math.max(0, Math.min(1, (fx + fy - 0.3) * 0.8));
    const cR = 30 + (17 - 30) * cardGrad;
    const cG = 41 + (24 - 41) * cardGrad;
    const cB = 59 + (39 - 59) * cardGrad;
    color = blendOver(color, cR, cG, cB, 1);

    // Subtle 3x3 board squares inside card
    if (fx >= 0.33 && fx <= 0.72 && fy >= 0.24 && fy <= 0.63) {
      const gx = Math.floor((fx - 0.33) / 0.13);
      const gy = Math.floor((fy - 0.24) / 0.13);
      if ((gx + gy) % 2 === 0) {
        color = blendOver(color, 148, 163, 184, 0.14);
      }
    }

    // Crisp card border
    if (dFront > -0.018) {
      color = blendOver(color, 71, 85, 105, 0.95);
    }

    // 3. Chess knight silhouette inside front card
    const inBase = sdRoundedRect(fx, fy, 0.525, 0.725, 0.135, 0.032, 0.014) <= 0;
    const inNeck = pointInPolygon(fx, fy, KNIGHT_HEAD_POLY);
    const inEye = Math.hypot(fx - 0.455, fy - 0.315) <= 0.017;
    if ((inBase || inNeck) && !inEye) {
      color = blendOver(color, 248, 250, 252, 1);
    }
  }

  // 4. Emerald swipe-right badge at bottom-right
  const badgeCx = 0.75;
  const badgeCy = 0.74;
  const badgeR = 0.138;
  const dBadge = Math.hypot(ux - badgeCx, uy - badgeCy);

  if (dBadge <= badgeR + 0.026) {
    // Dark outline ring around badge
    color = blendOver(color, 11, 17, 32, 1);
  }
  if (dBadge <= badgeR) {
    const bGrad = Math.max(0, Math.min(1, (ux - badgeCx + uy - badgeCy + badgeR) / (2 * badgeR)));
    const eR = 52 + (16 - 52) * bGrad;
    const eG = 211 + (185 - 211) * bGrad;
    const eB = 153 + (129 - 153) * bGrad;
    color = blendOver(color, eR, eG, eB, 1);

    // Crisp right-pointing arrow inside badge
    const strokeW = 0.022;
    const dShaft = distToSegment(ux, uy, badgeCx - 0.055, badgeCy, badgeCx + 0.052, badgeCy);
    const dTopHead = distToSegment(
      ux,
      uy,
      badgeCx + 0.008,
      badgeCy - 0.044,
      badgeCx + 0.054,
      badgeCy
    );
    const dBotHead = distToSegment(
      ux,
      uy,
      badgeCx + 0.008,
      badgeCy + 0.044,
      badgeCx + 0.054,
      badgeCy
    );
    if (Math.min(dShaft, dTopHead, dBotHead) <= strokeW) {
      color = blendOver(color, 11, 17, 32, 1);
    }
  }

  return color;
}

function renderIconPng(size, options) {
  const ss = 2; // 2x2 supersampling for crisp anti-aliased edges
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss) / size;
          const ny = (y + (sy + 0.5) / ss) / size;
          const sample = sampleIconPixel(nx, ny, options);
          r += sample[0] * sample[3];
          g += sample[1] * sample[3];
          b += sample[2] * sample[3];
          a += sample[3];
        }
      }
      const samples = ss * ss;
      const outA = a / samples;
      const idx = (y * size + x) * 4;
      if (outA > 0) {
        rgba[idx] = Math.round(Math.min(255, Math.max(0, r / a)));
        rgba[idx + 1] = Math.round(Math.min(255, Math.max(0, g / a)));
        rgba[idx + 2] = Math.round(Math.min(255, Math.max(0, b / a)));
        rgba[idx + 3] = Math.round(Math.min(255, Math.max(0, outA * 255)));
      }
    }
  }

  return encodePngRgba(size, size, rgba);
}

mkdirSync(ICONS_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, roundedMask: true, safeScale: 0.96 },
  { file: 'icon-512.png', size: 512, roundedMask: true, safeScale: 0.96 },
  // Full-bleed maskable icon with 80% safe-zone inset (0.76 scale keeps all artwork well inside Android adaptive masks)
  { file: 'icon-512-maskable.png', size: 512, roundedMask: false, safeScale: 0.76 },
  // Apple touch icon: full-bleed square (iOS applies its own squircle mask)
  { file: 'apple-touch-icon.png', size: 180, roundedMask: false, safeScale: 0.88 },
];

for (const target of targets) {
  const png = renderIconPng(target.size, {
    roundedMask: target.roundedMask,
    safeScale: target.safeScale,
  });
  const outPath = resolve(ICONS_DIR, target.file);
  writeFileSync(outPath, png);
  console.log(`Generated ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}
