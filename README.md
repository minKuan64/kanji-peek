# Kanji Peek

Quét một vùng màn hình → đọc ra kanji → hiện **cách đọc** (kana + romaji + âm Hán-Việt) và nghĩa tiếng Anh.

Chạy **hoàn toàn offline**. Không có lời gọi mạng nào lúc sử dụng: từ điển, dữ liệu OCR và mã nguồn đều nằm trong extension.

## Cài đặt

```bash
git clone https://github.com/minKuan64/kanji-peek.git
cd kanji-peek
npm install
npm run setup      # ~3 phút, cần mạng, chỉ chạy một lần
```

Rồi mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục này.

> Chrome bản chính thức đã chặn cờ `--load-extension`, nên bắt buộc phải nạp bằng tay qua giao diện.

`npm run setup` gồm ba bước, chạy riêng lẻ cũng được:

| Lệnh | Việc | Kết quả |
|---|---|---|
| `npm run vendor` | Copy Tesseract từ `node_modules`, tải dữ liệu OCR tiếng Nhật | `vendor/` ~9MB |
| `npm run build:dict` | Tải JMdict + KANJIDIC2 + Unihan, dựng từ điển đã chia shard | `data/` ~60MB |
| `npm run icons` | Sinh icon PNG | `icons/` 16KB |

`vendor/` và `data/` **không nằm trong repo** — toàn file nhị phân và dữ liệu tái tạo được, commit vào chỉ làm phình lịch sử git. Repo chỉ chứa mã nguồn (~100KB).

## Dùng thế nào

| Tình huống | Thao tác |
|---|---|
| Kanji nằm trong tab Chrome (Meet, Teams web, Confluence, PDF…) | **Alt+Shift+K** rồi kéo chọn vùng |
| Kanji nằm trong app ngoài Chrome (Zoom, Teams bản cài) | **⌘⌃⇧4** chụp vào clipboard → **⌘V** dán vào panel |
| Đã có sẵn chữ | Gõ hoặc dán thẳng vào ô nhập |

Kết quả hiện trong **side panel**, không phải đè lên trang. Đây là chủ ý: khi bạn share **một tab Chrome**, thứ được truyền đi chỉ là nội dung tab — side panel nằm ngoài vùng chụp nên người khác không thấy, còn thẻ kết quả vẽ đè lên trang thì sẽ hiện ra trước mặt cả phòng họp.

Văn bản OCR đọc được có thể **sửa trực tiếp** — sai một nét là tra trượt cả từ, sửa xong danh sách tự cập nhật.

## Kiểm tra

```bash
npm run test:dict      # tách từ, khử chia động từ, romaji, âm Hán-Việt
npm run test:ocr       # độ chính xác OCR đầu-cuối (render bằng Chrome headless)
```

Số đo hiện tại: OCR **98,6%** ký tự đúng trên chữ 14–24px ở màn Retina; tra cứu **~20ms** lần đầu, **<1ms** khi cache đã nóng.

## Kiến trúc

```
manifest.json          MV3
src/background.js      service worker — phím tắt, chụp tab, điều phối
src/content/overlay.js chỉ vẽ khung kéo chọn, không hiện kết quả
src/sidepanel/         UI + Tesseract + tra từ điển (phần nặng nằm hết ở đây)
src/lib/dict.js        nạp shard, tách từ, ghép âm Hán-Việt
src/lib/deinflect.js   đưa dạng chia về dạng từ điển
src/lib/jp.js          nhận dạng loại ký tự, kana→romaji, dọn text OCR
data/                  từ điển đã dựng (build:dict sinh ra)
vendor/                Tesseract + dữ liệu OCR tiếng Nhật
tools/                 script dựng dữ liệu, sinh icon, chạy test
```

### Vài quyết định đáng ghi lại

**Phần nặng đặt trong side panel, không đặt trong service worker.** SW của MV3 bị tắt sau ~30 giây rảnh; Tesseract và cache từ điển cần sống lâu. Panel sống suốt lúc mở.

**Từ điển băm theo ký tự ĐẦU của từ** (512 shard, ~92KB/shard). Thuật toán tách từ thử mọi tiền tố bắt đầu tại cùng một vị trí, mà chúng luôn chung ký tự đầu → chỉ tốn **1 lần đọc file cho mỗi vị trí**. Nhờ vậy mới nhét được 464k từ mà vẫn tra tức thì và không ngốn RAM.

**Chọn từ bằng chấm điểm, không bằng độ dài.** Longest-match thuần tuý cắt `があります` thành `があ`(sấy tóc) + `り` + `ます`. Điểm = độ dài + thông dụng + có kanji thì ra `が` + `あります` đúng như mong đợi.

**`tessdata_fast` (2.4MB) thay vì bản chuẩn (34MB).** Đo thực tế cho 98,6% — chênh lệch không bù nổi 14 lần dung lượng và thời gian nạp.

**Có `host_permissions: ["<all_urls>"]`.** Quyền `activeTab` chỉ được cấp khi bấm icon / dùng phím tắt / chọn context menu — **không** cấp khi bấm nút trong side panel, nên thiếu mục này thì nút "Quét vùng" sẽ lỗi trên tab chưa từng dùng phím tắt. Nếu bạn muốn quyền tối thiểu thì xoá dòng đó đi và chỉ dùng Alt+Shift+K.

## Giới hạn đã biết

- **Âm Hán-Việt có thể chưa chuẩn với một số chữ.** KANJIDIC2 ghi nhiều âm cho một chữ và không xếp theo độ thông dụng. Đã dùng Unihan của Unicode sửa thứ tự cho 584 chữ, nhưng Unihan không phủ chữ giản lược kiểu Nhật (`発` vẫn ra "Bát" trước "Phát"). Khi còn âm khác, giao diện hiện đủ dạng `Bát / Phát` để bạn tự chọn thay vì hiện bừa một âm.
- **Không có nghĩa tiếng Việt cho từ ghép.** JMdict không có bản dịch tiếng Việt (chỉ có Anh, Hà Lan, Pháp, Đức, Hung, Nga, Slovenia, Tây Ban Nha, Thuỵ Điển). Phần tiếng Việt chỉ là âm Hán-Việt ghép từ từng chữ.
- **Chữ dọc (縦書き)** chưa hỗ trợ — cần thêm `jpn_vert.traineddata`.
- **Trang `chrome://` và Chrome Web Store** không cho tiêm script; dùng đường dán ảnh.

## Nguồn dữ liệu

- [JMdict / KANJIDIC2](http://www.edrdg.org/) — EDRDG, giấy phép CC BY-SA 4.0, qua bản JSON của [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified)
- [Unihan](https://www.unicode.org/charts/unihan.html) — Unicode, dùng để sắp lại thứ tự âm Hán-Việt
- [Tesseract](https://github.com/tesseract-ocr/tesseract) — Apache 2.0
