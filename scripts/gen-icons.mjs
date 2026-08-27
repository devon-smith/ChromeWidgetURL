// Pure-Node PNG icon generator (no external deps). Supersampled for anti-aliasing.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// ---- Brand palette (kept consistent with the extension CSS accent) ----
const ACCENT = [0xF2, 0x54, 0x5B];   // coral-red #F2545B
const ACCENT2 = [0xE0, 0x3B, 0x50];  // deeper coral for gradient bottom
const WHITE = [0xFF, 0xFF, 0xFF];

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// Signed distance to a rounded rectangle centered in a box of size `size`.
function roundRectAlpha(px, py, x0, y0, w, h, r) {
  // distance from point to rounded rect; returns coverage-ish via clamp
  const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
  // if inside the straight zones
  const insideX = px >= x0 && px <= x0 + w;
  const insideY = py >= y0 && py <= y0 + h;
  if (px >= x0 + r && px <= x0 + w - r && insideY) return insideY ? 1 : 0;
  if (py >= y0 + r && py <= y0 + h - r && insideX) return insideX ? 1 : 0;
  // corner: distance to nearest corner center
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) <= r ? 1 : 0;
}

function renderSize(size) {
  const SS = 4;                 // supersample factor
  const S = size * SS;
  const buf = new Float32Array(S * S * 4); // rgba accumulation at supersample res

  const pad = S * 0.055;
  const bgR = S * 0.235;        // outer rounded-square corner radius
  const bx = pad, by = pad, bw = S - pad * 2, bh = S - pad * 2;

  // three stacked "tab/card" bars (decreasing width, centered-left)
  const barH = bh * 0.135;
  const gap = bh * 0.075;
  const totalH = barH * 3 + gap * 2;
  const startY = by + (bh - totalH) / 2;
  const barX = bx + bw * 0.2;
  const barW = bw * 0.6;
  const barR = barH * 0.5;
  const widths = [barW, barW * 0.82, barW * 0.64];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // background rounded square with vertical gradient
      const inBg = roundRectAlpha(x + 0.5, y + 0.5, bx, by, bw, bh, bgR);
      if (!inBg) { buf[i + 3] = 0; continue; }
      const t = (y - by) / bh;
      const c = mix(ACCENT, ACCENT2, Math.min(Math.max(t, 0), 1));
      let r = c[0], g = c[1], b = c[2];

      // white bars on top
      let barAlpha = 0;
      for (let k = 0; k < 3; k++) {
        const yy = startY + k * (barH + gap);
        if (roundRectAlpha(x + 0.5, y + 0.5, barX, yy, widths[k], barH, barR)) {
          barAlpha = 1; break;
        }
      }
      if (barAlpha) { r = WHITE[0]; g = WHITE[1]; b = WHITE[2]; }

      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }

  // downsample SS->1 with box filter (straight alpha average)
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const si = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          const sa = buf[si + 3] / 255;
          r += buf[si] * sa; g += buf[si + 1] * sa; b += buf[si + 2] * sa; a += sa;
        }
      }
      const n = SS * SS;
      const oi = (y * size + x) * 4;
      const alpha = a / n;
      out[oi] = a > 0 ? Math.round(r / a) : 0;
      out[oi + 1] = a > 0 ? Math.round(g / a) : 0;
      out[oi + 2] = a > 0 ? Math.round(b / a) : 0;
      out[oi + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

// ---- Minimal PNG encoder (RGBA, 8-bit) ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // filtered raw (filter byte 0 per row)
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = process.argv[2] || '.';
mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  const rgba = renderSize(s);
  writeFileSync(`${outDir}/icon-${s}.png`, encodePNG(rgba, s));
  console.log(`wrote ${outDir}/icon-${s}.png`);
}
console.log('done');
