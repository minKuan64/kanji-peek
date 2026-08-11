/** Tiện ích xử lý chữ viết tiếng Nhật: nhận dạng loại ký tự, chuyển kana, và romaji. */

const KANJI = /[一-鿿㐀-䶿豈-﫿]/;
const HIRAGANA = /[ぁ-ゟ]/;
const KATAKANA = /[ァ-ヿㇰ-ㇿ]/;
const JP_PUNCT = /[　-〿！-･]/;

export const isKanji = (c) => KANJI.test(c);
export const isHiragana = (c) => HIRAGANA.test(c);
export const isKatakana = (c) => KATAKANA.test(c);
export const isKana = (c) => HIRAGANA.test(c) || KATAKANA.test(c);
export const isJapanese = (c) => isKanji(c) || isKana(c) || /[ーヽヾ々〆〤]/.test(c);
export const isJapanesePunct = (c) => JP_PUNCT.test(c);

/** Katakana -> hiragana. JMdict đánh index theo kana gốc nên ta so khớp cả hai chiều. */
export function toHiragana(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    // Khoảng katakana ァ..ヶ nằm cách hiragana đúng 0x60.
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
  }
  return out;
}

/**
 * OCR hay chèn khoảng trắng giả giữa các ký tự CJK vì Tesseract căn theo
 * khoảng cách hình học. Ta chỉ bỏ khoảng trắng NẰM GIỮA hai ký tự Nhật,
 * giữ lại khoảng trắng thật giữa các từ Latin.
 */
export function cleanOcrText(raw) {
  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t　]+/g, ' ')
        .replace(/(?<=[　-ヿ一-鿿！-･]) (?=[　-ヿ一-鿿！-･])/g, '')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

/* --------------------------------------------------------------- ROMAJI --- */

const ROMAJI_MAP = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',
  か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
  ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',
  だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',
  は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',
  ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',
  や:'ya',ゆ:'yu',よ:'yo',
  ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',
  わ:'wa',ゐ:'wi',ゑ:'we',を:'wo',ん:'n',
  ゔ:'vu',
};

const YOON = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo', ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',
  しゃ:'sha',しゅ:'shu',しょ:'sho', じゃ:'ja',じゅ:'ju',じょ:'jo',
  ちゃ:'cha',ちゅ:'chu',ちょ:'cho', ぢゃ:'ja',ぢゅ:'ju',ぢょ:'jo',
  にゃ:'nya',にゅ:'nyu',にょ:'nyo', ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',
  びゃ:'bya',びゅ:'byu',びょ:'byo', ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo', りゃ:'rya',りゅ:'ryu',りょ:'ryo',
  ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',
  てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',
  うぃ:'wi',うぇ:'we',うぉ:'wo', ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo',
  しぇ:'she',じぇ:'je',ちぇ:'che',
};

const VOWEL_OF = { a:'a', i:'i', u:'u', e:'e', o:'o' };

/** Kana -> romaji kiểu Hepburn. Xử lý っ (gemination) và ー (trường âm). */
export function toRomaji(kana) {
  const s = toHiragana(kana);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const pair = s.slice(i, i + 2);

    if (YOON[pair]) {
      out += YOON[pair];
      i += 2;
      continue;
    }
    // っ nhân đôi phụ âm đầu của âm tiết kế tiếp.
    if (s[i] === 'っ') {
      const nxt = YOON[s.slice(i + 1, i + 3)] || ROMAJI_MAP[s[i + 1]] || '';
      out += nxt ? (nxt[0] === 'c' ? 't' : nxt[0]) : 'tsu';
      i += 1;
      continue;
    }
    // ー kéo dài nguyên âm vừa phát ra.
    if (s[i] === 'ー' || s[i] === '－') {
      const last = out[out.length - 1];
      if (VOWEL_OF[last]) out += last;
      i += 1;
      continue;
    }
    if (ROMAJI_MAP[s[i]]) {
      // ん đứng trước nguyên âm hoặc y cần dấu ' để khỏi đọc dính:
      // きんえん -> kin'en, chứ không phải kinen (= きねん, nghĩa khác hẳn).
      if (s[i] === 'ん' && /[あいうえおやゆよ]/.test(s[i + 1] || '')) out += "n'";
      else out += ROMAJI_MAP[s[i]];
      i += 1;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}
