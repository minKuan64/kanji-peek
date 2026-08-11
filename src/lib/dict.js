/**
 * Bộ máy tra cứu: nạp shard theo nhu cầu, tách từ theo longest-match,
 * ghép âm Hán-Việt từ KANJIDIC2.
 *
 * Module này chạy trong offscreen document (sống lâu) nên cache shard và
 * cache kanji giữ được giữa các lần tra — lần thứ hai gần như tức thì.
 */

import { deinflect } from './deinflect.js';
import { isHiragana, isJapanese, isKanji, isKana, toHiragana, toRomaji } from './jp.js';

const url = (p) => chrome.runtime.getURL(p);

let metaPromise = null;
let kanjiPromise = null;
const shardCache = new Map(); // idx -> { map, maxLen }

function loadMeta() {
  if (!metaPromise) metaPromise = fetch(url('data/meta.json')).then((r) => r.json());
  return metaPromise;
}

function loadKanji() {
  if (!kanjiPromise) kanjiPromise = fetch(url('data/kanji.json')).then((r) => r.json());
  return kanjiPromise;
}

/** Phải khớp TỪNG BIT với shardOf() trong tools/build-dict.mjs. */
function shardIndex(term, shards) {
  let h = 0x811c9dc5;
  const cp = term.codePointAt(0);
  h ^= cp & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (cp >>> 8) & 0xff;
  h = Math.imul(h, 0x01000193);
  h ^= (cp >>> 16) & 0xff;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0) % shards;
}

async function loadShard(firstChar) {
  const meta = await loadMeta();
  const idx = shardIndex(firstChar, meta.shards);
  let cached = shardCache.get(idx);
  if (cached) return cached;

  const map = await fetch(url(`data/words/${idx}.json`)).then((r) => r.json());
  // Từ dài nhất trong shard này quyết định cửa sổ quét — sát hơn nhiều so với
  // dùng maxTermLength toàn cục (37 ký tự), nên tiết kiệm được rất nhiều vòng lặp.
  let maxLen = 1;
  for (const key in map) if (key.length > maxLen) maxLen = key.length;

  cached = { map, maxLen };
  shardCache.set(idx, cached);
  return cached;
}

/* ------------------------------------------------------------------ KANJI */

/** Âm Hán-Việt của cả từ: ghép âm từng chữ. 議事録 -> "Nghị Sự Lục" */
export async function hanViet(word) {
  const kanji = await loadKanji();
  const parts = [];
  for (const ch of word) {
    if (!isKanji(ch)) continue;
    const rec = kanji[ch];
    if (!rec?.v) return ''; // thiếu một chữ thì chuỗi Hán-Việt vô nghĩa
    parts.push(rec.v);
  }
  return parts.join(' ');
}

/** Thông tin từng kanji có mặt trong `text`, không lặp, giữ thứ tự xuất hiện. */
export async function kanjiBreakdown(text) {
  const kanji = await loadKanji();
  const seen = new Set();
  const out = [];
  for (const ch of text) {
    if (!isKanji(ch) || seen.has(ch)) continue;
    seen.add(ch);
    const rec = kanji[ch];
    if (!rec) continue;
    out.push({
      char: ch,
      hanViet: rec.v || '',
      // Các âm Hán-Việt khác mà KANJIDIC ghi nhận. Giao diện hiện kèm để người
      // đọc tự chọn, vì thứ tự trong KANJIDIC không theo độ thông dụng.
      hanVietAlt: rec.va || [],
      on: rec.on || [],
      kun: rec.kun || [],
      meanings: rec.m || [],
      strokes: rec.s || null,
      jlpt: rec.j || null,
      grade: rec.g || null,
    });
  }
  return out;
}

/* --------------------------------------------------------------- TRA TỪ --- */

async function decorate(surface, term, entries, inflected) {
  const first = entries[0];
  const readings = [];
  for (const entry of entries) for (const r of entry.r) if (!readings.includes(r)) readings.push(r);

  return {
    surface, // đúng như trong văn bản (có thể đang chia)
    term, // dạng từ điển
    inflected,
    reading: readings[0] || '',
    readings,
    romaji: readings[0] ? toRomaji(readings[0]) : '',
    hanViet: await hanViet(term),
    common: Boolean(first.c),
    senses: entries.flatMap((e) => e.s).slice(0, 8),
  };
}

/** Mã từ loại của động từ / tính từ đuôi -i trong JMdict (v1, v5r, vk, vs-i, adj-i…). */
const VERBISH = /(^|,)(v[0-9]|v[knrsz]|aux-v|adj-i)/;

const isVerbish = (entries) => entries.some((e) => e.s.some((s) => VERBISH.test(s.p)));

const hasKanji = (str) => [...str].some(isKanji);

/**
 * Chấm điểm một ứng viên khi tách từ.
 *
 * Longest-match thuần tuý thất bại ở những ca như 「があります」: mục từ hiếm
 * 「があ」 (sấy tóc) dài hơn nên thắng trợ từ 「が」, làm hỏng cả phần còn lại
 * của câu. Cộng thêm điểm cho từ thông dụng và từ có kanji thì thứ tự đúng lại.
 */
function score(surface, entries, inflected) {
  let value = surface.length * 3;
  if (entries.some((e) => e.c)) value += 4; // có gắn cờ "common" trong JMdict
  if (hasKanji(surface)) value += 3; // trong văn bản họp, cụm kanji mới là thứ cần tra
  if (inflected) value -= 1; // khớp trực tiếp đáng tin hơn khớp qua suy diễn
  return value;
}

/** Tìm ứng viên tốt nhất bắt đầu tại `start`. Trả về null nếu không có gì. */
function bestMatchAt(text, start, shard, windowSize) {
  const maxLen = Math.min(shard.maxLen, windowSize, text.length - start);
  let best = null;
  let bestScore = -Infinity;

  for (let len = maxLen; len >= 1; len--) {
    const cand = text.slice(start, start + len);

    const exact = shard.map[cand];
    if (exact) {
      const value = score(cand, exact, false);
      if (value > bestScore) {
        bestScore = value;
        best = { surface: cand, term: cand, entries: exact, inflected: false };
      }
      continue;
    }

    // Dạng chia luôn kết thúc bằng kana — phép thử rẻ này loại phần lớn
    // lời gọi deinflect() vô ích.
    if (len >= 2 && isKana(cand[cand.length - 1])) {
      for (const { term } of deinflect(cand)) {
        const entries = shard.map[term];
        // Đã khử chia thì kết quả buộc phải là động từ / tính từ; nếu không,
        // ta chỉ đang khớp trúng một danh từ đồng âm ngẫu nhiên.
        if (!entries || !isVerbish(entries)) continue;
        const value = score(cand, entries, true);
        if (value > bestScore) {
          bestScore = value;
          best = { surface: cand, term, entries, inflected: true };
        }
        break; // deinflect() đã xếp theo độ tin cậy — ứng viên đầu là đủ
      }
    }
  }

  return best;
}

/** Tra chính xác một từ (có thử khử chia). */
export async function lookup(word) {
  const text = word.trim();
  if (!text) return null;

  const shard = await loadShard(text[0]);
  if (shard.map[text]) return decorate(text, text, shard.map[text], false);

  for (const { term } of deinflect(text)) {
    if (shard.map[term]) return decorate(text, term, shard.map[term], true);
  }

  // Katakana gõ thành hiragana (hoặc ngược lại) vẫn nên tra ra.
  const hira = toHiragana(text);
  if (hira !== text) {
    const alt = await loadShard(hira[0]);
    if (alt.map[hira]) return decorate(text, hira, alt.map[hira], false);
  }
  return null;
}

/** Từ ghép dài hơn ngần này gần như chắc chắn là cả cụm, không phải một mục từ. */
const SCAN_WINDOW = 16;

/**
 * Tách văn bản thành các từ đã biết.
 *
 * Tại mỗi vị trí, mọi ứng viên đều chung ký tự đầu nên chỉ tốn ĐÚNG MỘT lần
 * nạp shard cho mỗi vị trí bắt đầu — đó là lý do dữ liệu được băm theo ký tự đầu.
 */
export async function segment(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (!isJapanese(ch)) {
      i += 1;
      continue;
    }

    const shard = await loadShard(ch);
    const hit = bestMatchAt(text, i, shard, SCAN_WINDOW);
    if (hit) {
      tokens.push(await decorate(hit.surface, hit.term, hit.entries, hit.inflected));
      i += hit.surface.length;
    } else {
      i += 1;
    }
  }

  return tokens;
}

/**
 * Trợ từ và động từ chức năng thuần hiragana (の, を, は, する, なる…) chỉ làm
 * nhiễu danh sách. Katakana thì luôn giữ: từ mượn ngắn như 「メモ」 vẫn có thể lạ.
 */
const isFunctionWord = (token) => token.term.length <= 3 && [...token.term].every(isHiragana);

/** Kết quả đầy đủ cho một đoạn văn bản: từ vựng + kanji rời. */
export async function analyze(text, { includeKana = false } = {}) {
  const clean = text.trim();
  if (!clean) return { text: clean, tokens: [], kanji: [] };

  const [tokens, kanji] = await Promise.all([segment(clean), kanjiBreakdown(clean)]);

  // Slide hay lặp từ; gộp lại và đếm để danh sách khỏi dài lê thê.
  const merged = [];
  const byTerm = new Map();
  for (const token of tokens) {
    if (!includeKana && isFunctionWord(token)) continue;
    const existing = byTerm.get(token.term);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const rec = { ...token, count: 1 };
    byTerm.set(token.term, rec);
    merged.push(rec);
  }

  return { text: clean, tokens: merged, kanji };
}

export async function meta() {
  return loadMeta();
}
