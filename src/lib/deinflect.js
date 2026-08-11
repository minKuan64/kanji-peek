/**
 * Khử chia (deinflection): đưa dạng đã chia về dạng từ điển.
 *
 * Ta cố tình sinh DƯ ứng viên rồi để từ điển lọc lại. Cách này an toàn vì mọi
 * ứng viên đều giữ nguyên ký tự đầu, tức nằm trong shard đã nạp — thử thêm
 * vài chục ứng viên không tốn thêm lần đọc file nào.
 */

/** Ma trận biến đổi godan: [i-stem, đuôi từ điển, te, ta, a-stem, e-stem, o-stem] */
const GODAN = [
  ['き', 'く', 'いて', 'いた', 'か', 'け', 'こ'],
  ['ぎ', 'ぐ', 'いで', 'いだ', 'が', 'げ', 'ご'],
  ['し', 'す', 'して', 'した', 'さ', 'せ', 'そ'],
  ['ち', 'つ', 'って', 'った', 'た', 'て', 'と'],
  ['に', 'ぬ', 'んで', 'んだ', 'な', 'ね', 'の'],
  ['び', 'ぶ', 'んで', 'んだ', 'ば', 'べ', 'ぼ'],
  ['み', 'む', 'んで', 'んだ', 'ま', 'め', 'も'],
  ['り', 'る', 'って', 'った', 'ら', 'れ', 'ろ'],
  ['い', 'う', 'って', 'った', 'わ', 'え', 'お'],
];

/** Trợ động từ bám sau dạng -te (～ている, ～てしまう, ～てください…). */
const TE_TAILS = [
  '', 'いる', 'いる', 'います', 'いた', 'いました', 'いて', 'る', 'ます', 'た',
  'ました', 'ください', 'しまう', 'しまいます', 'しまった', 'おく', 'おきます',
  'みる', 'みます', 'ある', 'あります', 'いく', 'くる', 'も', 'は',
];

/** Đuôi bám sau i-stem (連用形): ～ます, ～たい, ～ながら… */
const ISTEM_TAILS = [
  '', 'ます', 'ません', 'ました', 'ませんでした', 'ましょう', 'まして',
  'たい', 'たく', 'たくない', 'たかった', 'たがる', 'ながら',
  'やすい', 'にくい', 'すぎる', 'すぎ', 'そう', 'つづける', 'はじめる', 'なさい',
];

/** Đuôi bám sau a-stem (未然形): ～ない, ～れる (bị động), ～せる (sai khiến)… */
const ASTEM_TAILS = [
  'ない', 'ないで', 'なかった', 'なくて', 'なければ', 'なきゃ', 'ず', 'ぬ', 'ん',
  'れる', 'れます', 'れた', 'れて', 'れない',
  'せる', 'せます', 'せた', 'せて', 'せない',
  'される', 'させる', 'せられる', 'れました', 'せました',
];

/** Đuôi của tính từ đuôi -i. */
const I_ADJ_TAILS = [
  ['くない', 'い'], ['くありません', 'い'], ['くなかった', 'い'], ['くなくて', 'い'],
  ['かった', 'い'], ['くて', 'い'], ['ければ', 'い'], ['かったら', 'い'],
  ['く', 'い'], ['さ', 'い'], ['そう', 'い'], ['すぎる', 'い'], ['げ', 'い'],
];

/** Đuôi của động từ ichidan (nhóm 2): bỏ る rồi gắn đuôi. */
const ICHIDAN_TAILS = [
  'ます', 'ません', 'ました', 'ませんでした', 'ましょう',
  'て', 'ている', 'てる', 'ています', 'ていた', 'ていました', 'てください', 'てしまう',
  'た', 'たら', 'たり', 'ない', 'なかった', 'なくて', 'なければ', 'ず',
  'られる', 'られます', 'させる', 'させます', 'られ', 'れば', 'よう', 'ろ', 'よ',
  'たい', 'たかった', 'たく', 'ながら', 'やすい', 'にくい', 'すぎる', 'そう', 'なさい',
];

/** Bất quy tắc: する và 来る/くる. */
const IRREGULAR = [
  // する
  ['します', 'する'], ['しません', 'する'], ['しました', 'する'], ['しましょう', 'する'],
  ['して', 'する'], ['している', 'する'], ['してる', 'する'], ['しています', 'する'],
  ['していた', 'する'], ['していました', 'する'], ['してください', 'する'],
  ['した', 'する'], ['したら', 'する'], ['しない', 'する'], ['しなかった', 'する'],
  ['できる', 'する'], ['できます', 'する'], ['される', 'する'], ['させる', 'する'],
  ['させられる', 'する'], ['しよう', 'する'], ['すれば', 'する'], ['しろ', 'する'],
  ['せよ', 'する'], ['したい', 'する'], ['し', 'する'],
  // 来る (viết kanji thì phần đuôi kana mới đổi)
  ['きます', 'くる'], ['きて', 'くる'], ['きた', 'くる'], ['こない', 'くる'],
  ['こられる', 'くる'], ['こさせる', 'くる'], ['こよう', 'くる'], ['くれば', 'くる'],
  ['来ます', '来る'], ['来て', '来る'], ['来た', '来る'], ['来ない', '来る'],
  ['来られる', '来る'], ['来させる', '来る'], ['来よう', '来る'], ['来れば', '来る'],
  // 行く chia bất quy tắc ở dạng -te
  ['行って', '行く'], ['行った', '行く'], ['いって', 'いく'], ['いった', 'いく'],
  // copula
  ['です', 'だ'], ['でした', 'だ'], ['ではない', 'だ'], ['じゃない', 'だ'],
];

/**
 * Độ ưu tiên luật — số nhỏ là đáng tin hơn.
 *
 * Đây là thứ phân định các ca như 「してください」: luật ichidan chung cắt
 * 「てください」 rồi gắn 「る」 ra 「しる」 (= 汁, nước ép), còn luật bất quy tắc
 * cho thẳng 「する」. Hai kết quả dài bằng nhau nên xếp theo độ dài là hoà;
 * luật đặc thù phải thắng luật tổng quát.
 */
const P_IRREGULAR = 0; // khớp nguyên dạng, không suy đoán
const P_GODAN = 1; // suy ra từ ma trận godan, khá chắc
const P_ICHIDAN = 2; // chỉ cắt đuôi rồi gắn る — dễ ra từ vô nghĩa

/** Bảng luật phẳng: đuôi cần cắt -> Map(đuôi thay vào -> độ ưu tiên). */
const RULES = (() => {
  const map = new Map();
  const add = (from, to, priority) => {
    if (!from || from === to) return;
    if (!map.has(from)) map.set(from, new Map());
    const targets = map.get(from);
    const existing = targets.get(to);
    if (existing === undefined || priority < existing) targets.set(to, priority);
  };

  for (const [iStem, dict, te, ta, aStem, eStem, oStem] of GODAN) {
    for (const tail of ISTEM_TAILS) add(iStem + tail, dict, P_GODAN);
    for (const tail of TE_TAILS) {
      add(te + tail, dict, P_GODAN);
      add(ta + tail, dict, P_GODAN);
    }
    add(ta, dict, P_GODAN);
    add(ta + 'ら', dict, P_GODAN);
    add(ta + 'り', dict, P_GODAN);
    for (const tail of ASTEM_TAILS) add(aStem + tail, dict, P_GODAN);
    add(eStem + 'る', dict, P_GODAN); // khả năng: 書ける -> 書く
    add(eStem + 'ます', dict, P_GODAN);
    add(eStem + 'ば', dict, P_GODAN); // điều kiện
    add(eStem, dict, P_GODAN); // mệnh lệnh
    add(oStem + 'う', dict, P_GODAN); // ý chí
  }

  for (const tail of ICHIDAN_TAILS) add(tail, 'る', P_ICHIDAN);
  for (const [from, to] of I_ADJ_TAILS) add(from, to, P_IRREGULAR);
  for (const [from, to] of IRREGULAR) add(from, to, P_IRREGULAR);

  return map;
})();

/** Đuôi dài nhất trong bảng — dùng để giới hạn cửa sổ cắt. */
const MAX_SUFFIX = Math.max(...[...RULES.keys()].map((k) => k.length));

const cache = new Map();
const CACHE_LIMIT = 4000;

/**
 * Trả về mọi dạng từ điển có thể có của `word` (không gồm chính nó), dạng
 * `{ term, cost }`. `cost` = tổng độ ưu tiên luật + số bước đã áp dụng, nên
 * chuỗi suy diễn ngắn và luật đáng tin luôn đứng trước.
 *
 * Cố tình sinh dư: từ điển sẽ lọc lại, và mọi ứng viên đều chung ký tự đầu
 * nên không phát sinh thêm lần nạp shard nào.
 */
export function deinflect(word, maxDepth = 3) {
  const hit = cache.get(word);
  if (hit) return hit;

  const best = new Map([[word, 0]]); // dạng -> cost rẻ nhất tìm được
  const queue = [[word, 0, 0]]; // [dạng, độ sâu, cost]

  while (queue.length) {
    const [current, depth, cost] = queue.shift();
    if (depth >= maxDepth) continue;

    const limit = Math.min(MAX_SUFFIX, current.length);
    for (let len = limit; len >= 1; len--) {
      const suffix = current.slice(current.length - len);
      const targets = RULES.get(suffix);
      if (!targets) continue;
      const head = current.slice(0, current.length - len);
      // Bỏ dạng chỉ còn đuôi: 「して」->「する」 hợp lệ, nhưng 「て」->「る」 thì vô nghĩa.
      if (!head && current.length <= 2) continue;
      for (const [to, priority] of targets) {
        const next = head + to;
        if (!next) continue;
        const nextCost = cost + priority + 1;
        const known = best.get(next);
        if (known !== undefined && known <= nextCost) continue;
        best.set(next, nextCost);
        queue.push([next, depth + 1, nextCost]);
      }
    }
  }

  best.delete(word);
  const out = [...best.entries()]
    .map(([term, cost]) => ({ term, cost }))
    .sort((a, b) => a.cost - b.cost || b.term.length - a.term.length);

  if (cache.size > CACHE_LIMIT) cache.clear();
  cache.set(word, out);
  return out;
}
