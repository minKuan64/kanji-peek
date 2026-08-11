#!/usr/bin/env node
/**
 * Dựng lại thư mục vendor/.
 *
 * Manifest V3 cấm nạp code từ xa, nên Tesseract (thư viện + nhân wasm + dữ liệu
 * ngôn ngữ) phải nằm hẳn trong extension. vendor/ không được commit vì toàn file
 * nhị phân 9MB tái tạo được — script này dựng lại từ node_modules và GitHub.
 *
 *   npm run vendor
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const MODULES = path.join(ROOT, 'node_modules');

/**
 * Chỉ lấy hai biến thể `-lstm`: tesseract.js chọn relaxedsimd nếu trình duyệt hỗ
 * trợ, không thì lùi về simd. Chrome 116 (bản tối thiểu của extension) luôn có
 * SIMD nên bản không-SIMD là thừa, bỏ đi tiết kiệm 3.7MB.
 */
const COPIES = [
  ['tesseract.js/dist/tesseract.min.js', 'tesseract/tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  [
    'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract/tesseract-core-simd-lstm.wasm.js',
  ],
];

// Dữ liệu ngôn ngữ KHÔNG có trên npm — phải tải từ kho tessdata của Tesseract.
// Bản `fast` 2.4MB, đo được 98.6% ký tự đúng với chữ trên màn hình (xem test:ocr);
// bản chuẩn nặng 34MB nên không đáng đổi.
const TESSDATA_URL =
  'https://github.com/tesseract-ocr/tessdata_fast/raw/main/jpn.traineddata';

const log = (...a) => console.log('[vendor]', ...a);

fs.mkdirSync(path.join(VENDOR, 'tesseract'), { recursive: true });
fs.mkdirSync(path.join(VENDOR, 'tessdata'), { recursive: true });

for (const [from, to] of COPIES) {
  const src = path.join(MODULES, from);
  if (!fs.existsSync(src)) {
    console.error(`Thiếu ${from}. Chạy \`npm install\` trước.`);
    process.exit(1);
  }
  const dest = path.join(VENDOR, to);
  fs.copyFileSync(src, dest);
  log(`${to}  ${(fs.statSync(dest).size / 1048576).toFixed(1)}MB`);
}

const traineddata = path.join(VENDOR, 'tessdata/jpn.traineddata.gz');
if (fs.existsSync(traineddata)) {
  log('tessdata/jpn.traineddata.gz đã có, bỏ qua');
} else {
  log('tải jpn.traineddata…');
  const res = await fetch(TESSDATA_URL);
  if (!res.ok) throw new Error(`tải tessdata lỗi ${res.status}`);
  // tesseract.js mặc định tìm file .gz, nên nén luôn — nhẹ hơn 0.9MB.
  fs.writeFileSync(traineddata, zlib.gzipSync(Buffer.from(await res.arrayBuffer()), { level: 9 }));
  log(`tessdata/jpn.traineddata.gz  ${(fs.statSync(traineddata).size / 1048576).toFixed(1)}MB`);
}

log('xong.');
