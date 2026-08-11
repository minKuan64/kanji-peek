/**
 * Content script: chỉ làm đúng một việc — cho người dùng kéo chọn một vùng
 * trên trang, rồi báo toạ độ về service worker.
 *
 * Kết quả tra cứu KHÔNG hiện ở đây mà hiện trong side panel. Lý do: khi bạn
 * share một tab Chrome, thứ được truyền đi là nội dung tab — thẻ kết quả vẽ đè
 * lên trang sẽ hiện ra trước mặt cả cuộc họp, còn side panel thì không.
 */

(() => {
  // Service worker có thể tiêm lại script này nhiều lần; chỉ gắn listener một lần.
  if (window.__kanjiPeekReady) return;
  window.__kanjiPeekReady = true;

  const HOST_ID = 'kanji-peek-overlay-host';
  let host = null;
  let root = null;
  let box = null;
  let hint = null;
  let start = null;
  let active = false;

  const CSS = `
    :host { all: initial; }
    .layer {
      position: fixed; inset: 0; z-index: 2147483647;
      cursor: crosshair; background: rgba(15, 23, 42, .28);
      /* Không nhận sự kiện chuột thì không kéo chọn được, nên để mặc định. */
    }
    .box {
      position: fixed; box-sizing: border-box;
      border: 1.5px solid #7dd3fc;
      background: rgba(125, 211, 252, .12);
      /* Vùng chọn sáng hơn phần còn lại: đổ bóng cực lớn ra ngoài để "khoét lỗ". */
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, .28);
      display: none; pointer-events: none;
    }
    .hint {
      position: fixed; left: 50%; top: 16px; transform: translateX(-50%);
      font: 500 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #e2e8f0; background: rgba(15, 23, 42, .92);
      padding: 6px 12px; border-radius: 999px; pointer-events: none;
      box-shadow: 0 2px 12px rgba(0,0,0,.35); white-space: nowrap;
    }
  `;

  function build() {
    host = document.createElement('div');
    host.id = HOST_ID;
    root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const layer = document.createElement('div');
    layer.className = 'layer';

    box = document.createElement('div');
    box.className = 'box';

    hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Kéo để chọn vùng chứa kanji — Esc để huỷ';

    root.append(style, layer, box, hint);
    document.documentElement.append(host);

    layer.addEventListener('mousedown', onDown);
    layer.addEventListener('mousemove', onMove);
    layer.addEventListener('mouseup', onUp);
  }

  function show() {
    if (!host) build();
    host.style.display = '';
    box.style.display = 'none';
    hint.style.display = '';
    start = null;
    active = true;
    window.addEventListener('keydown', onKey, true);
  }

  function hide() {
    active = false;
    if (host) host.style.display = 'none';
    window.removeEventListener('keydown', onKey, true);
  }

  function onKey(event) {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  }

  function onDown(event) {
    if (event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    box.style.display = 'block';
    hint.style.display = 'none';
    draw(event);
  }

  function onMove(event) {
    if (start) draw(event);
  }

  function draw(event) {
    const left = Math.min(start.x, event.clientX);
    const top = Math.min(start.y, event.clientY);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.abs(event.clientX - start.x)}px`;
    box.style.height = `${Math.abs(event.clientY - start.y)}px`;
  }

  function onUp(event) {
    if (!start) return;
    const rect = {
      left: Math.min(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
    start = null;

    // Nhấp nhầm chứ không phải kéo chọn.
    if (rect.width < 6 || rect.height < 6) {
      hide();
      return;
    }

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };

    // Phải ẩn lớp phủ TRƯỚC khi chụp, nếu không lớp tối và khung xanh sẽ lọt
    // vào ảnh và làm hỏng OCR. Đợi hai khung hình để chắc chắn trình duyệt đã vẽ lại.
    hide();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({ type: 'KP_CROP_DONE', rect, viewport });
      })
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'KP_START_CROP') show();
  });
})();
