/**
 * Service worker: điều phối giữa phím tắt, content script và side panel.
 *
 * Bản thân nó không xử lý ảnh hay tra từ — OCR và từ điển đều nằm trong side
 * panel, vì service worker của MV3 bị tắt sau ~30 giây rảnh, mà Tesseract cùng
 * cache từ điển thì cần sống lâu.
 */

const JOB_KEY = 'pendingJob';

chrome.runtime.onInstalled.addListener(enableActionOpensPanel);
chrome.runtime.onStartup?.addListener(enableActionOpensPanel);

function enableActionOpensPanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

/**
 * Chuyển một việc sang side panel.
 *
 * Gửi tin trực tiếp KHÔNG đủ tin cậy: phím tắt có thể vừa mở panel xong, và
 * panel chưa kịp đăng ký listener. Nên ta ghi luôn vào storage.session — panel
 * đọc lại lúc khởi động. `id` giúp panel bỏ qua việc đã xử lý.
 */
async function toPanel(payload) {
  const job = { ...payload, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  await chrome.storage.session.set({ [JOB_KEY]: job });
  chrome.runtime.sendMessage(job).catch(() => {
    /* panel chưa mở — nó sẽ tự lấy từ storage */
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * Bật chế độ kéo chọn vùng trên tab hiện tại.
 *
 * Content script được tiêm theo yêu cầu chứ không khai báo sẵn trong manifest:
 * công cụ này chỉ dùng thỉnh thoảng, không đáng để chèn script vào mọi trang.
 * Thử gửi tin trước — nếu script đã có sẵn thì khỏi tiêm lại.
 */
async function startCrop(tab) {
  if (!tab?.id) return { ok: false, reason: 'no-tab' };

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'KP_START_CROP' });
    return { ok: true };
  } catch {
    // chưa tiêm — tiêm rồi thử lại
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/overlay.js'],
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'KP_START_CROP' });
    return { ok: true };
  } catch (err) {
    // chrome://, Chrome Web Store, trang cài đặt… đều chặn việc tiêm script.
    return { ok: false, reason: 'blocked', detail: String(err?.message || err) };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-region') return;
  const tab = await activeTab();
  if (!tab) return;

  // Mở panel TRƯỚC: chrome.sidePanel.open() đòi cử chỉ người dùng, mà cử chỉ
  // của phím tắt chỉ còn hiệu lực ở ngay đầu handler.
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    /* panel đã mở sẵn */
  }

  const result = await startCrop(tab);
  if (!result.ok) await toPanel({ type: 'KP_CROP_BLOCKED', reason: result.reason });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script báo đã kéo chọn xong -> chụp tab rồi chuyển cho panel.
  if (message?.type === 'KP_CROP_DONE') {
    (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
          format: 'png',
        });
        await toPanel({
          type: 'KP_IMAGE',
          dataUrl,
          rect: message.rect,
          viewport: message.viewport,
        });
        sendResponse({ ok: true });
      } catch (err) {
        await toPanel({ type: 'KP_ERROR', message: String(err?.message || err) });
        sendResponse({ ok: false });
      }
    })();
    return true; // giữ kênh mở cho phản hồi bất đồng bộ
  }

  // Panel bấm nút "Quét vùng".
  if (message?.type === 'KP_REQUEST_CROP') {
    (async () => sendResponse(await startCrop(await activeTab())))();
    return true;
  }

  return false;
});
