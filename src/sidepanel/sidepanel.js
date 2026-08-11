/**
 * Side panel: toàn bộ phần nặng của extension nằm ở đây — OCR (Tesseract) và
 * tra từ điển. Đặt ở đây thay vì trong service worker vì SW của MV3 bị tắt sau
 * ~30 giây rảnh, còn panel thì sống suốt lúc đang mở, giữ được worker OCR đã
 * khởi động và cache từ điển đã nạp.
 */

import { analyze } from '../lib/dict.js';
import { cleanOcrText } from '../lib/jp.js';

const els = {
  status: document.getElementById('status'),
  capture: document.getElementById('capture'),
  clear: document.getElementById('clear'),
  input: document.getElementById('input'),
  ocrbox: document.getElementById('ocrbox'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty'),
  optKana: document.getElementById('opt-kana'),
  optLine: document.getElementById('opt-line'),
};

const settings = { includeKana: false, singleLine: false };
let handledJobId = null;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

/* ---------------------------------------------------------------- OCR --- */

let workerPromise = null;

/**
 * Khởi động Tesseract. Mọi đường dẫn đều trỏ vào file nằm trong extension:
 * Manifest V3 cấm nạp code từ xa, nên mặc định tải core từ CDN của tesseract.js
 * sẽ bị CSP chặn.
 */
function getWorker() {
  if (workerPromise) return workerPromise;

  setStatus('đang khởi động OCR…');
  workerPromise = Tesseract.createWorker('jpn', 1, {
    workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/tesseract/'),
    langPath: chrome.runtime.getURL('vendor/tessdata/'),
    // Mặc định tesseract.js bọc worker trong blob: URL — CSP của trang extension
    // chặn worker-src blob:, nên phải nạp thẳng từ file.
    workerBlobURL: false,
    // Dữ liệu ngôn ngữ đã nằm sẵn trong extension, khỏi nhân bản vào IndexedDB.
    cacheMethod: 'none',
    logger: ({ status, progress }) => {
      if (status === 'loading tesseract core' || status === 'loading language traineddata') {
        setStatus(`đang tải OCR… ${Math.round((progress || 0) * 100)}%`);
      }
    },
  }).catch((err) => {
    workerPromise = null; // cho phép thử lại ở lần sau
    throw err;
  });

  return workerPromise;
}

/**
 * Phóng to và khử màu vùng ảnh trước khi đưa vào OCR.
 *
 * Chữ trên màn hình thường chỉ cao 14–16px CSS; Tesseract nhận dạng kanji kém
 * hẳn ở cỡ đó vì kanji có nhiều nét sát nhau. Phóng lên khoảng 2000px theo cạnh
 * dài cải thiện rõ rệt mà vẫn không làm OCR chậm.
 */
function prepareCanvas(source, sx, sy, sw, sh) {
  const factor = Math.min(3, Math.max(1, 2000 / Math.max(sw, sh)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * factor);
  canvas.height = Math.round(sh * factor);

  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(1) contrast(1.15)';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function runOcr(canvas) {
  const worker = await getWorker();
  await worker.setParameters({
    // 6 = một khối văn bản nhiều dòng; 7 = đúng một dòng.
    tessedit_pageseg_mode: settings.singleLine ? '7' : '6',
    // Tiếng Nhật không có dấu cách; để Tesseract tự chèn chỉ tạo khoảng trắng giả.
    preserve_interword_spaces: '0',
  });
  const { data } = await worker.recognize(canvas);
  return cleanOcrText(data.text || '');
}

/** Cắt đúng vùng người dùng đã kéo chọn từ ảnh chụp toàn bộ tab. */
async function ocrCapturedRegion({ dataUrl, rect, viewport }) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  // captureVisibleTab trả ảnh theo PIXEL THIẾT BỊ, còn toạ độ kéo chọn là pixel
  // CSS. Tự suy tỉ lệ từ chính bức ảnh đáng tin hơn là dùng devicePixelRatio,
  // vì Chrome có lúc giới hạn kích thước ảnh chụp.
  const scale = bitmap.width / viewport.width;
  const sx = Math.max(0, rect.left * scale);
  const sy = Math.max(0, rect.top * scale);
  const sw = Math.min(bitmap.width - sx, rect.width * scale);
  const sh = Math.min(bitmap.height - sy, rect.height * scale);
  if (sw < 4 || sh < 4) throw new Error('vùng chọn quá nhỏ');

  const text = await runOcr(prepareCanvas(bitmap, sx, sy, sw, sh));
  bitmap.close();
  return text;
}

async function ocrWholeImage(source) {
  const bitmap = await createImageBitmap(source);
  const text = await runOcr(prepareCanvas(bitmap, 0, 0, bitmap.width, bitmap.height));
  bitmap.close();
  return text;
}

/* ------------------------------------------------------------- HIỂN THỊ --- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderWord(token) {
  const card = el('div', 'word');

  const top = el('div', 'word-top');
  top.append(el('span', 'term', token.term));
  if (token.reading && token.reading !== token.term) {
    top.append(el('span', 'reading', token.reading));
  }
  if (token.romaji) top.append(el('span', 'romaji', token.romaji));
  if (token.inflected) top.append(el('span', 'tag', `dạng chia: ${token.surface}`));
  if (token.count > 1) top.append(el('span', 'tag', `×${token.count}`));
  card.append(top);

  if (token.hanViet) card.append(el('span', 'hanviet', token.hanViet));

  for (const sense of token.senses.slice(0, 3)) {
    const line = el('div', 'gloss');
    if (sense.p) line.append(el('span', 'pos', `${sense.p} · `));
    line.append(el('b', null, sense.g));
    card.append(line);
  }

  return card;
}

function renderKanji(list) {
  const box = el('details', 'kanji');
  box.append(el('summary', null, `Từng chữ (${list.length})`));

  for (const item of list) {
    const row = el('div', 'kanji-row');
    row.append(el('div', 'kanji-char', item.char));

    const body = el('div', 'kanji-body');
    if (item.hanViet) {
      const hv = el('span', 'hanviet', item.hanViet);
      // KANJIDIC không phải lúc nào cũng xếp âm thông dụng lên đầu, nên khi còn
      // âm khác thì hiện ra để người đọc tự chọn thay vì tin một âm có thể sai.
      if (item.hanVietAlt?.length) {
        hv.append(el('span', 'alt', ` / ${item.hanVietAlt.join(' / ')}`));
      }
      body.append(hv);
    }

    const readings = [];
    if (item.on.length) readings.push(`on ${item.on.join('・')}`);
    if (item.kun.length) readings.push(`kun ${item.kun.join('・')}`);
    if (readings.length) body.append(el('div', 'kanji-meta', readings.join('   ')));

    if (item.meanings.length) {
      body.append(el('div', 'gloss', item.meanings.slice(0, 4).join('; ')));
    }

    const facts = [];
    if (item.strokes) facts.push(`${item.strokes} nét`);
    if (item.jlpt) facts.push(`JLPT N${item.jlpt}`);
    if (facts.length) body.append(el('div', 'kanji-meta', facts.join(' · ')));

    row.append(body);
    box.append(row);
  }

  return box;
}

/**
 * Đặt văn bản OCR vào ô sửa tay. OCR đọc nhầm một nét là tra trượt cả từ, nên
 * sửa được trực tiếp quan trọng hơn là làm giao diện gọn.
 */
function setOcrText(text) {
  const node = el('div', 'ocr', text);
  node.contentEditable = 'plaintext-only';
  node.spellcheck = false;
  node.title = 'Sửa trực tiếp nếu OCR đọc sai';
  node.addEventListener('input', () => scheduleAnalyze(node.textContent));
  els.ocrbox.replaceChildren(node);
}

async function show(text) {
  const result = await analyze(text, { includeKana: settings.includeKana });

  els.results.replaceChildren();

  if (!result.tokens.length && !result.kanji.length) {
    const empty = el('div', 'empty');
    empty.append(el('p', null, 'Không nhận ra từ tiếng Nhật nào.'));
    empty.append(
      el(
        'p',
        'muted',
        'Thử chọn vùng sát chữ hơn, hoặc bật "Ảnh chỉ có một dòng" nếu chỉ quét một dòng.'
      )
    );
    els.results.append(empty);
    setStatus('');
    return;
  }

  for (const token of result.tokens) els.results.append(renderWord(token));
  if (result.kanji.length) els.results.append(renderKanji(result.kanji));

  setStatus(`${result.tokens.length} từ · ${result.kanji.length} kanji`);
}

/* --------------------------------------------------------------- LUỒNG --- */

let analyzeTimer = null;

function scheduleAnalyze(text) {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => {
    show(text).catch((err) => setStatus(String(err.message || err), true));
  }, 220);
}

/** Chạy OCR rồi hiển thị; `read` là hàm bất đồng bộ trả về văn bản. */
async function runAndShow(read, busyText, emptyText) {
  try {
    setStatus(busyText);
    const text = await read();
    if (!text) {
      setStatus(emptyText, true);
      return;
    }
    els.input.value = '';
    setOcrText(text);
    await show(text);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
}

const handleImageJob = (job) =>
  runAndShow(
    () => ocrCapturedRegion(job),
    'đang đọc chữ…',
    'không đọc được chữ nào trong vùng đã chọn'
  );

const handlePastedImage = (file) =>
  runAndShow(() => ocrWholeImage(file), 'đang đọc chữ từ ảnh…', 'không đọc được chữ nào trong ảnh');

function handleJob(job) {
  if (!job || job.id === handledJobId) return;
  handledJobId = job.id;

  if (job.type === 'KP_IMAGE') handleImageJob(job);
  else if (job.type === 'KP_CROP_BLOCKED') {
    setStatus('trang này không cho quét — dùng ⌘⌃⇧4 rồi dán ảnh vào đây', true);
  } else if (job.type === 'KP_ERROR') setStatus(job.message, true);
}

/* ---------------------------------------------------------------- NỐI --- */

chrome.runtime.onMessage.addListener((message) => {
  handleJob(message);
});

// Bấm phím tắt lúc panel còn đóng: service worker đã cất việc vào storage,
// panel vừa mở lên thì lấy ra xử lý.
chrome.storage.session.get('pendingJob').then(({ pendingJob }) => handleJob(pendingJob));

els.capture.addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'KP_REQUEST_CROP' });
  if (result?.ok) setStatus('kéo chọn vùng trên trang…');
  else setStatus('trang này không cho quét — dùng ⌘⌃⇧4 rồi dán ảnh vào đây', true);
});

function reset() {
  els.input.value = '';
  els.ocrbox.replaceChildren();
  els.results.replaceChildren(els.empty);
  setStatus('');
}

els.clear.addEventListener('click', reset);

els.input.addEventListener('input', () => {
  const text = els.input.value.trim();
  if (!text) {
    reset();
    return;
  }
  // Gõ tay thì không có văn bản OCR nào để sửa nữa.
  els.ocrbox.replaceChildren();
  scheduleAnalyze(text);
});

// Dán ảnh: đường thoát cho mọi ứng dụng ngoài Chrome (Zoom, Teams bản cài đặt).
document.addEventListener('paste', (event) => {
  const item = [...(event.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
  if (!item) return;
  event.preventDefault();
  const file = item.getAsFile();
  if (file) handlePastedImage(file);
});

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  handlePastedImage(file);
});

/* ------------------------------------------------------------ TUỲ CHỌN --- */

function bindOption(checkbox, key) {
  checkbox.addEventListener('change', () => {
    settings[key] = checkbox.checked;
    chrome.storage.local.set({ [key]: checkbox.checked });
    const current = document.querySelector('.ocr')?.textContent || els.input.value.trim();
    if (current) scheduleAnalyze(current);
  });
}

chrome.storage.local.get(['includeKana', 'singleLine']).then((saved) => {
  settings.includeKana = Boolean(saved.includeKana);
  settings.singleLine = Boolean(saved.singleLine);
  els.optKana.checked = settings.includeKana;
  els.optLine.checked = settings.singleLine;
});

bindOption(els.optKana, 'includeKana');
bindOption(els.optLine, 'singleLine');

// Nạp trước Tesseract ngay khi mở panel: lần quét đầu tiên khỏi phải chờ ~2 giây.
getWorker()
  .then(() => setStatus('sẵn sàng'))
  .catch((err) => setStatus(`không khởi động được OCR: ${err.message || err}`, true));
