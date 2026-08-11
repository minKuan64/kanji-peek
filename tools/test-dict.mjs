#!/usr/bin/env node
/**
 * Chạy bộ máy tra cứu ngoài Chrome bằng cách giả lập chrome.runtime.getURL + fetch.
 * Dùng để kiểm tra tách từ / khử chia / âm Hán-Việt mà không cần reload extension.
 *
 *   node tools/test-dict.mjs                  # bộ test mặc định
 *   node tools/test-dict.mjs "本日の議事録"    # tự nhập câu
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.chrome = { runtime: { getURL: (p) => path.join(ROOT, p) } };
globalThis.fetch = async (filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`404 ${filePath}`);
  const body = fs.readFileSync(filePath, 'utf8');
  return { ok: true, json: async () => JSON.parse(body), text: async () => body };
};

const { analyze, lookup } = await import('../src/lib/dict.js');
const { deinflect } = await import('../src/lib/deinflect.js');
const { toRomaji, cleanOcrText } = await import('../src/lib/jp.js');

const custom = process.argv.slice(2);

const SAMPLES = custom.length
  ? custom
  : [
      '本日の議事録を確認してください',
      '来週の打ち合わせは中止になりました',
      '納期が遅れる可能性があります',
      '見積書を添付いたします',
      '進捗状況を報告します',
      '要件定義書のレビューをお願いします',
      '課題管理表',
      'この件について検討させていただきます',
      '不具合が発生している',
      '株式会社',
    ];

function show(label, value) {
  console.log(`  ${label.padEnd(9)} ${value}`);
}

for (const sample of SAMPLES) {
  console.log(`\n\x1b[1m${sample}\x1b[0m`);
  const t0 = performance.now();
  const res = await analyze(sample);
  const ms = (performance.now() - t0).toFixed(0);

  for (const tok of res.tokens) {
    const head = tok.surface + (tok.inflected ? ` → ${tok.term}` : '');
    const gloss = tok.senses[0]?.g?.slice(0, 62) || '';
    console.log(
      `  \x1b[36m${head}\x1b[0m  ${tok.reading} (${tok.romaji})` +
        (tok.hanViet ? `  \x1b[33m[${tok.hanViet}]\x1b[0m` : '') +
        `\n      ${gloss}`
    );
  }
  console.log(`  \x1b[90m${res.tokens.length} từ, ${res.kanji.length} kanji, ${ms}ms\x1b[0m`);
}

// Kiểm tra riêng vài điểm dễ sai.
console.log('\n\x1b[1m— Kiểm tra chi tiết —\x1b[0m');
show('romaji', `きんえん → ${toRomaji('きんえん')} (phải là kin'en, không phải kinen)`);
show('romaji', `がっこう → ${toRomaji('がっこう')}`);
show('romaji', `コンピューター → ${toRomaji('コンピューター')}`);
show('deinflect', `確認して → ${deinflect('確認して').slice(0, 4).map((x) => x.term).join(', ')}`);
show('deinflect', `書きました → ${deinflect('書きました').slice(0, 4).map((x) => x.term).join(', ')}`);
show('deinflect', `食べられない → ${deinflect('食べられない').slice(0, 4).map((x) => x.term).join(', ')}`);
show('ocr-clean', `"議 事 録 を 確認" → "${cleanOcrText('議 事 録 を 確認')}"`);
show('ocr-clean', `"ABC 議事録 DEF" → "${cleanOcrText('ABC 議事録 DEF')}"`);

const single = await lookup('打ち合わせ');
show('lookup', `打ち合わせ → ${single?.reading} [${single?.hanViet}] ${single?.senses[0]?.g}`);

// Đo tốc độ khi cache đã nóng — đây mới là con số người dùng cảm nhận.
const t1 = performance.now();
await analyze('本日の議事録を確認してください');
show('cache nóng', `${(performance.now() - t1).toFixed(1)}ms`);
