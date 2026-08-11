#!/usr/bin/env node
/**
 * Kiểm tra chất lượng OCR đầu-cuối.
 *
 * Câu hỏi cần trả lời: dữ liệu `tessdata_fast` (2.4MB) có đủ chính xác với chữ
 * kanji cỡ nhỏ trên màn hình không, hay phải đổi sang bản chuẩn 34MB?
 *
 * Cách làm: Chrome headless render vài câu tiếng Nhật ở đúng cỡ chữ thường gặp
 * trong slide họp, chụp lại, rồi cho chính bộ OCR của extension đọc và đối chiếu.
 *
 *   node tools/test-ocr.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CASES = [
  { text: '本日の議事録を確認してください', px: 16 },
  { text: '来週の打ち合わせは中止になりました', px: 16 },
  { text: '進捗状況を報告します', px: 20 },
  { text: '要件定義書のレビューをお願いします', px: 14 },
  { text: '納期遅延の可能性があります', px: 24 },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-ocr-'));

/**
 * Render tất cả câu vào MỘT ảnh — mỗi lần gọi Chrome tốn vài giây.
 *
 * Chrome với --headless=new ghi xong ảnh nhưng KHÔNG tự thoát, nên execFileSync
 * sẽ treo tới hết timeout. Vì vậy ta chạy nền, chờ file xuất hiện và ngừng tăng
 * kích thước (tức đã ghi xong), rồi tự kill tiến trình.
 */
async function renderSample() {
  const rows = CASES.map(
    (c) => `<div style="font-size:${c.px}px;margin:14px 0">${c.text}</div>`
  ).join('');

  const html = path.join(tmp, 'sample.html');
  fs.writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8">
     <body style="margin:20px;background:#fff;color:#111;
                  font-family:'Hiragino Sans','Noto Sans JP',sans-serif">
       ${rows}
     </body>`
  );

  const png = path.join(tmp, 'sample.png');
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=2', // giả lập màn Retina như máy thật
      '--window-size=640,400',
      `--screenshot=${png}`,
      `--user-data-dir=${path.join(tmp, 'profile')}`,
      `file://${html}`,
    ],
    { stdio: 'ignore', detached: true }
  );

  let lastSize = -1;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (!fs.existsSync(png)) continue;
    const size = fs.statSync(png).size;
    if (size > 0 && size === lastSize) break; // kích thước ổn định = ghi xong
    lastSize = size;
  }

  try {
    process.kill(-child.pid);
  } catch {
    /* đã thoát rồi */
  }

  if (!fs.existsSync(png) || fs.statSync(png).size === 0) {
    throw new Error('Chrome không tạo được ảnh mẫu');
  }
  return png;
}

/** Khoảng cách Levenshtein, dùng để tính tỉ lệ ký tự đọc đúng. */
function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmpVal = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmpVal;
    }
  }
  return prev[b.length];
}

const png = await renderSample();
console.log(`ảnh mẫu: ${png}\n`);

const worker = await createWorker('jpn', 1, {
  langPath: path.join(ROOT, 'vendor/tessdata'),
  cachePath: tmp,
  logger: () => {},
});
await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });

const { data } = await worker.recognize(png);
await worker.terminate();

const { cleanOcrText } = await import('../src/lib/jp.js');
const lines = cleanOcrText(data.text).split('\n');

let totalChars = 0;
let totalErrors = 0;

for (const [i, expected] of CASES.entries()) {
  const got = lines[i] ?? '';
  const errors = distance(expected.text, got);
  totalChars += expected.text.length;
  totalErrors += errors;
  const exact = got === expected.text;
  console.log(`${exact ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${expected.px}px`);
  console.log(`   mong đợi: ${expected.text}`);
  if (!exact) console.log(`   đọc được: ${got}   (${errors} ký tự sai)`);
}

const accuracy = (1 - totalErrors / totalChars) * 100;
console.log(`\nđộ chính xác ký tự: \x1b[1m${accuracy.toFixed(1)}%\x1b[0m (${totalErrors}/${totalChars} sai)`);

fs.rmSync(tmp, { recursive: true, force: true });
