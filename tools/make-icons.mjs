#!/usr/bin/env node
/**
 * Sinh icon PNG cho extension.
 *
 * Tự mã hoá PNG bằng zlib có sẵn của Node thay vì gọi Chrome headless hay thêm
 * thư viện đồ hoạ: icon chỉ là mấy hình khối, mà cách này chạy trong ~50ms và
 * không phụ thuộc gì bên ngoài.
 *
 * Hình: chữ 三 trắng trên nền vuông bo góc chuyển sắc xanh. Chọn 三 vì nó vẫn
 * là một chữ kanji thật nhưng đủ thưa nét để không bết lại ở cỡ 16px.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // hệ số siêu lấy mẫu để bo góc không bị răng cưa

/* ------------------------------------------------------------------- PNG */

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
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** Đóng gói buffer RGBA thành file PNG 8-bit truecolour+alpha. */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // độ sâu bit
  ihdr[9] = 6; // RGBA
  // [10..12] = nén / lọc / xen kẽ, đều là 0

  // Mỗi hàng quét phải mở đầu bằng một byte kiểu lọc; 0 = không lọc.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    const to = y * (size * 4 + 1) + 1;
    rgba.copy(raw, to, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ VẼ */

/** Ba nét ngang của chữ 三, theo toạ độ chuẩn hoá 0..1. */
const STROKES = [
  { x0: 0.28, x1: 0.72, y0: 0.265, y1: 0.355 },
  { x0: 0.36, x1: 0.64, y0: 0.455, y1: 0.545 },
  { x0: 0.22, x1: 0.78, y0: 0.645, y1: 0.735 },
];

const lerp = (a, b, t) => a + (b - a) * t;

function insideRounded(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function render(size) {
  const big = size * SS;
  const radius = big * 0.22;
  const strokeRadius = big * 0.012;
  const hi = [14, 165, 233]; // #0ea5e9
  const lo = [29, 78, 216]; // #1d4ed8

  // Vẽ ở độ phân giải gấp SS lần rồi thu nhỏ — cách khử răng cưa rẻ nhất.
  const acc = new Float64Array(size * size * 4);

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (insideRounded(x + 0.5, y + 0.5, big, radius)) {
        const t = (x / big + y / big) / 2; // chuyển sắc theo đường chéo
        r = lerp(hi[0], lo[0], t);
        g = lerp(hi[1], lo[1], t);
        b = lerp(hi[2], lo[2], t);
        a = 255;

        const nx = (x + 0.5) / big;
        const ny = (y + 0.5) / big;
        for (const s of STROKES) {
          const inX = nx >= s.x0 && nx <= s.x1;
          const inY = ny >= s.y0 && ny <= s.y1;
          if (!inX || !inY) continue;
          // bo nhẹ hai đầu nét
          const ex = Math.min(nx - s.x0, s.x1 - nx) * big;
          const ey = Math.min(ny - s.y0, s.y1 - ny) * big;
          if (ex < strokeRadius && ey < strokeRadius) {
            const dx = strokeRadius - ex;
            const dy = strokeRadius - ey;
            if (dx * dx + dy * dy > strokeRadius * strokeRadius) continue;
          }
          r = 255;
          g = 255;
          b = 255;
        }
      }

      const i = ((y / SS) | 0) * size * 4 + ((x / SS) | 0) * 4;
      acc[i] += r;
      acc[i + 1] += g;
      acc[i + 2] += b;
      acc[i + 3] += a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / n);
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(render(size), size));
  console.log(`icon${size}.png  ${fs.statSync(file).size} bytes`);
}
console.log('xong.');
