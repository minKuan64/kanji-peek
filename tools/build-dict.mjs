#!/usr/bin/env node
/**
 * Xây dữ liệu từ điển cho Kanji Peek.
 *
 *   node tools/build-dict.mjs [--common] [--shards=512]
 *
 * Nguồn: scriptin/jmdict-simplified (JMdict + KANJIDIC2, giấy phép CC BY-SA 4.0 / EDRDG).
 * Đầu ra:
 *   data/meta.json          thông tin phiên bản + số shard
 *   data/kanji.json         13k kanji: âm on/kun, nghĩa EN, ÂM HÁN-VIỆT, số nét, JLPT
 *   data/words/<n>.json     index từ vựng, băm theo ký tự đầu của từ
 *
 * Vì sao băm theo ký tự đầu: thuật toán tách từ longest-match thử mọi tiền tố
 * bắt đầu tại cùng một vị trí; chúng luôn chung ký tự đầu nên chỉ cần nạp 1 shard.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(os.tmpdir(), 'kanji-peek-src');

const argv = process.argv.slice(2);
const USE_COMMON = argv.includes('--common');
const KANJI_ONLY = argv.includes('--kanji-only'); // bỏ qua bước JMdict 47MB khi chỉ chỉnh kanji
const SHARDS = Number((argv.find((a) => a.startsWith('--shards=')) || '').split('=')[1] || 512);

const RELEASE_API = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';

/** Băm chuỗi -> chỉ số shard. FNV-1a 32-bit: nhanh, phân bố đều, dễ lặp lại y hệt ở phía extension. */
function shardOf(str) {
  let h = 0x811c9dc5;
  const cp = str.codePointAt(0);
  h ^= cp & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (cp >>> 8) & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (cp >>> 16) & 0xff;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0) % SHARDS;
}

function log(...a) {
  console.log('[build-dict]', ...a);
}

async function resolveAssets() {
  log('đang hỏi GitHub release mới nhất…');
  const res = await fetch(RELEASE_API, { headers: { 'User-Agent': 'kanji-peek-build' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const rel = await res.json();
  const pick = (prefix) => {
    const a = rel.assets.find((x) => x.name.startsWith(prefix) && x.name.endsWith('.zip'));
    if (!a) throw new Error(`không tìm thấy asset ${prefix}`);
    return a;
  };
  return {
    tag: rel.tag_name,
    jmdict: pick(USE_COMMON ? 'jmdict-eng-common-' : 'jmdict-eng-'),
    kanjidic: pick('kanjidic2-all-'),
  };
}

async function fetchAndUnzip(asset) {
  fs.mkdirSync(CACHE, { recursive: true });
  const zipPath = path.join(CACHE, asset.name);
  if (!fs.existsSync(zipPath)) {
    log(`tải ${asset.name} (${(asset.size / 1048576).toFixed(1)}MB)…`);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`tải lỗi ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  } else {
    log(`dùng cache ${asset.name}`);
  }
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', CACHE]);
  const jsonName = asset.name.replace(/\+\d+\.json\.zip$/, '.json');
  const jsonPath = path.join(CACHE, jsonName);
  if (!fs.existsSync(jsonPath)) {
    // tên file bên trong zip có thể khác chút — dò theo tiền tố
    const stem = asset.name.split('-').slice(0, 2).join('-');
    const found = fs
      .readdirSync(CACHE)
      .find((f) => f.startsWith(stem) && f.endsWith('.json'));
    if (!found) throw new Error(`không thấy JSON trong ${asset.name}`);
    return path.join(CACHE, found);
  }
  return jsonPath;
}

/* ----------------------------------------------------------------- UNIHAN */

/**
 * KANJIDIC2 liệt kê nhiều âm Hán-Việt cho một chữ nhưng THỨ TỰ KHÔNG THEO
 * ĐỘ THÔNG DỤNG: 発 ra ["Bát","Phát"], 会 ra ["Cối","Hội","Hụi"]. Lấy phần tử
 * đầu là hiện âm sai.
 *
 * Trường kVietnamese của Unihan (Unicode) được biên soạn kỹ hơn, nên ta dùng nó
 * để ĐẨY LÊN ĐẦU âm mà cả hai nguồn cùng công nhận. Unihan không phủ hết chữ
 * giản lược kiểu Nhật (発, 捗 đều trống) — những chữ đó giữ nguyên thứ tự
 * KANJIDIC và giao diện sẽ hiện đủ các âm để người đọc tự chọn.
 */
async function loadUnihanVietnamese() {
  fs.mkdirSync(CACHE, { recursive: true });
  const zipPath = path.join(CACHE, 'Unihan.zip');
  if (!fs.existsSync(zipPath)) {
    log('tải Unihan.zip (~9MB)…');
    const res = await fetch('https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip');
    if (!res.ok) throw new Error(`tải Unihan lỗi ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', zipPath, 'Unihan_Readings.txt', '-d', CACHE]);

  const map = new Map();
  const text = fs.readFileSync(path.join(CACHE, 'Unihan_Readings.txt'), 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [codePoint, field, ...rest] = line.split('\t');
    if (field !== 'kVietnamese') continue;
    const char = String.fromCodePoint(parseInt(codePoint.slice(2), 16));
    map.set(char, new Set(rest.join('\t').trim().toLowerCase().normalize('NFC').split(/\s+/)));
  }
  log(`Unihan: ${map.size} chữ có âm Việt`);
  return map;
}

/* ---------------------------------------------------------------- KANJIDIC */

function buildKanji(jsonPath, unihan) {
  log('đọc KANJIDIC2…');
  const src = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const out = {};
  let withVN = 0;
  let reordered = 0;

  for (const ch of src.characters) {
    const g = ch.readingMeaning?.groups?.[0];
    if (!g) continue;

    const on = [];
    const kun = [];
    const vnAll = [];
    for (const r of g.readings) {
      if (r.type === 'ja_on') on.push(r.value);
      else if (r.type === 'ja_kun') kun.push(r.value);
      // KANJIDIC lưu tiếng Việt ở dạng LAI: "hội" = h + ô(U+00F4) + dấu nặng
      // rời(U+0323) + i, trong khi Unihan dùng ộ(U+1ED9) dựng sẵn. Không đưa về
      // NFC thì mọi phép so chuỗi có dấu phụ đều trượt.
      else if (r.type === 'vietnam') vnAll.push(r.value.normalize('NFC'));
    }

    // Đẩy lên đầu âm được Unihan xác nhận.
    const confirmed = unihan.get(ch.literal);
    if (confirmed && vnAll.length > 1) {
      const idx = vnAll.findIndex((v) => confirmed.has(v.toLowerCase()));
      if (idx > 0) {
        vnAll.unshift(vnAll.splice(idx, 1)[0]);
        reordered++;
      }
    }

    const vn = vnAll[0] || '';
    const meanings = g.meanings.filter((m) => m.lang === 'en').map((m) => m.value);
    if (!meanings.length && !vn) continue;

    if (vn) withVN++;
    const rec = {};
    if (vn) rec.v = vn;
    // Giữ các âm còn lại để giao diện hiện "Phát / Bát" thay vì đoán bừa một âm.
    if (vnAll.length > 1) rec.va = vnAll.slice(1, 3);
    if (on.length) rec.on = on.slice(0, 6);
    if (kun.length) rec.kun = kun.slice(0, 6);
    if (meanings.length) rec.m = meanings.slice(0, 6);
    const strokes = ch.misc?.strokeCounts?.[0];
    if (strokes) rec.s = strokes;
    if (ch.misc?.jlptLevel) rec.j = ch.misc.jlptLevel;
    if (ch.misc?.grade) rec.g = ch.misc.grade;
    if (ch.misc?.frequency) rec.f = ch.misc.frequency;
    out[ch.literal] = rec;
  }

  const file = path.join(DATA, 'kanji.json');
  fs.writeFileSync(file, JSON.stringify(out));
  log(
    `kanji.json: ${Object.keys(out).length} chữ, ${withVN} có âm Hán-Việt ` +
      `(${reordered} chữ được Unihan sắp lại), ${(fs.statSync(file).size / 1048576).toFixed(1)}MB`
  );
  return Object.keys(out).length;
}

/* ------------------------------------------------------------------ JMDICT */

/** Một mục JMdict có thể ràng buộc cách đọc / nghĩa theo từng dạng chữ cụ thể. */
function appliesTo(list, term) {
  return !list || list.length === 0 || list.includes('*') || list.includes(term);
}

function buildWords(jsonPath) {
  log('đọc JMdict… (file lớn, ~30s)');
  const src = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  log(`${src.words.length} mục từ`);

  const shards = Array.from({ length: SHARDS }, () => ({}));
  let terms = 0;

  for (const w of src.words) {
    // Mọi dạng viết đều có thể là thứ OCR đọc ra, nên đánh index tất cả.
    const forms = [
      ...w.kanji.map((k) => ({ text: k.text, common: k.common, isKanji: true })),
      ...w.kana.map((k) => ({ text: k.text, common: k.common, isKanji: false })),
    ];

    for (const form of forms) {
      // Cách đọc kana hợp lệ cho đúng dạng chữ này.
      const readings = form.isKanji
        ? w.kana.filter((k) => appliesTo(k.appliesToKanji, form.text)).map((k) => k.text)
        : [form.text];
      if (!readings.length) continue;

      const senses = [];
      for (const s of w.sense) {
        const ok = form.isKanji
          ? appliesTo(s.appliesToKanji, form.text)
          : appliesTo(s.appliesToKana, form.text);
        if (!ok) continue;
        const gloss = s.gloss
          .filter((x) => x.lang === 'eng')
          .map((x) => x.text)
          .slice(0, 8)
          .join('; ');
        if (!gloss) continue;
        const rec = { p: s.partOfSpeech.join(','), g: gloss };
        if (s.field?.length) rec.f = s.field.join(',');
        if (s.misc?.length) rec.x = s.misc.join(',');
        senses.push(rec);
        if (senses.length >= 8) break;
      }
      if (!senses.length) continue;

      const entry = { r: readings.slice(0, 4), s: senses };
      if (form.common) entry.c = 1;

      const bucket = shards[shardOf(form.text)];
      if (!bucket[form.text]) {
        bucket[form.text] = [];
        terms++;
      }
      if (bucket[form.text].length < 6) bucket[form.text].push(entry);
    }
  }

  // Từ "common" hiện trước — trong họp thì nghĩa thông dụng gần như luôn đúng.
  for (const bucket of shards) {
    for (const key of Object.keys(bucket)) {
      bucket[key].sort((a, b) => (b.c || 0) - (a.c || 0));
    }
  }

  const dir = path.join(DATA, 'words');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let total = 0;
  let maxShard = 0;
  for (let i = 0; i < SHARDS; i++) {
    const body = JSON.stringify(shards[i]);
    fs.writeFileSync(path.join(dir, `${i}.json`), body);
    total += body.length;
    maxShard = Math.max(maxShard, body.length);
  }

  // Từ dài nhất quyết định cửa sổ quét của longest-match lúc chạy.
  let maxLen = 1;
  for (const bucket of shards) {
    for (const key in bucket) if (key.length > maxLen) maxLen = key.length;
  }

  log(
    `words/: ${terms} từ khoá, ${SHARDS} shard, tổng ${(total / 1048576).toFixed(1)}MB, ` +
      `shard lớn nhất ${(maxShard / 1024).toFixed(0)}KB, từ dài nhất ${maxLen} ký tự`
  );
  return { terms, maxLen, bytes: total };
}

/* -------------------------------------------------------------------- MAIN */

const assets = await resolveAssets();
fs.mkdirSync(DATA, { recursive: true });

const unihan = await loadUnihanVietnamese();
const kanjiPath = await fetchAndUnzip(assets.kanjidic);
const kanjiCount = buildKanji(kanjiPath, unihan);

const metaPath = path.join(DATA, 'meta.json');
if (KANJI_ONLY) {
  // Giữ nguyên phần thống kê từ vựng của lần build trước.
  const prev = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ ...prev, builtAt: new Date().toISOString(), kanjiCount }, null, 2)
  );
  log('xong (chỉ kanji).');
} else {
  const jmdictPath = await fetchAndUnzip(assets.jmdict);
  const words = buildWords(jmdictPath);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        source: assets.tag,
        builtAt: new Date().toISOString(),
        variant: USE_COMMON ? 'common' : 'full',
        shards: SHARDS,
        maxTermLength: words.maxLen,
        kanjiCount,
        termCount: words.terms,
      },
      null,
      2
    )
  );
  log('xong.');
}
