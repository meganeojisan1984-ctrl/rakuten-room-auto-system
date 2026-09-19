#!/usr/bin/env node
/**
 * プラグイン用 PNG アイコンを生成する（画像ライブラリ非依存・zlib のみ）。
 * 4倍解像度で描いてから縮小し、簡易アンチエイリアスをかける。
 *
 *   node tools/streamdeck/scripts/make-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const imgsDir = path.join(here, "..", "jp.rakutenroom.aiusage.sdPlugin", "imgs");

const SS = 4; // スーパーサンプリング倍率

function createCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size || a <= 0) return;
  const i = (y * canvas.size + x) * 4;
  const d = canvas.data;
  const inv = 1 - a;
  d[i] = d[i] * inv + r * a;
  d[i + 1] = d[i + 1] * inv + g * a;
  d[i + 2] = d[i + 2] * inv + b * a;
  d[i + 3] = d[i + 3] * inv + a;
}

const hex = (value) => {
  const n = parseInt(value.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function roundRect(canvas, x0, y0, w, h, radius, color, alpha = 1) {
  const [r, g, b] = hex(color);
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - radius - 1), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - radius - 1), 0);
      if (dx * dx + dy * dy > radius * radius) continue;
      blend(canvas, x, y, [r, g, b, alpha]);
    }
  }
}

function ring(canvas, cx, cy, outer, inner, color, alpha = 1, fromDeg = -220, toDeg = 40) {
  const [r, g, b] = hex(color);
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > outer || dist < inner) continue;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg > 90) deg -= 360;
      if (deg < fromDeg || deg > toDeg) continue;
      blend(canvas, x, y, [r, g, b, alpha]);
    }
  }
}

/** 4x キャンバスを縮小して RGBA バッファ化 */
function downsample(canvas, size) {
  const out = Buffer.alloc(size * size * 4);
  const factor = canvas.size / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          r += canvas.data[i];
          g += canvas.data[i + 1];
          b += canvas.data[i + 2];
          a += canvas.data[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // フィルタ None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** メーター風アイコンを描く */
function drawIcon(size, { background = true } = {}) {
  const canvas = createCanvas(size * SS);
  const s = size * SS;
  if (background) {
    roundRect(canvas, 0, 0, s, s, s * 0.22, "#0d141c", 1);
    roundRect(canvas, s * 0.02, s * 0.02, s * 0.96, s * 0.96, s * 0.2, "#16202b", 1);
  }
  const cx = s / 2;
  const cy = s * 0.54;
  ring(canvas, cx, cy, s * 0.36, s * 0.26, "#26333f", 1);
  ring(canvas, cx, cy, s * 0.36, s * 0.26, "#2ee6d6", 1, -220, -40);
  ring(canvas, cx, cy, s * 0.36, s * 0.26, "#5aa9ff", 1, -38, 10);
  roundRect(canvas, cx - s * 0.03, cy - s * 0.2, s * 0.06, s * 0.22, s * 0.03, "#e7eff7", 1);
  return encodePng(size, downsample(canvas, size));
}

fs.mkdirSync(imgsDir, { recursive: true });
const targets = [
  ["plugin", 72, true],
  ["plugin@2x", 144, true],
  ["category", 28, false],
  ["category@2x", 56, false],
  ["action", 20, false],
  ["action@2x", 40, false],
  ["key", 72, true],
  ["key@2x", 144, true],
];
for (const [name, size, background] of targets) {
  const file = path.join(imgsDir, `${name}.png`);
  fs.writeFileSync(file, drawIcon(size, { background }));
  console.log(`generated ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
