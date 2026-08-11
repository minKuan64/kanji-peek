# Kanji Peek

Select a region of your screen, get the **reading** of the Japanese words in it — kana, romaji, and Sino-Vietnamese — plus an English gloss.

Runs entirely offline. No network requests are made while you use it.

## Install

```bash
git clone https://github.com/minKuan64/kanji-peek.git
cd kanji-peek
npm install
npm run setup      # ~3 min, needs network, runs once
```

Then open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the project folder.

> Chrome no longer accepts the `--load-extension` flag, so the extension has to be loaded through the UI.

`npm run setup` runs three steps. You can also run them individually:

| Command | What it does | Output |
|---|---|---|
| `npm run vendor` | Copies Tesseract from `node_modules`, downloads Japanese OCR data | `vendor/` ~9 MB |
| `npm run build:dict` | Downloads JMdict + KANJIDIC2 + Unihan, builds the sharded dictionary | `data/` ~60 MB |
| `npm run icons` | Generates the PNG icons | `icons/` 16 KB |

`vendor/` and `data/` are not in the repository — they are binaries and generated data, rebuilt by `npm run setup`.

Requires Node 18+ and Chrome 116+.

## Usage

| Where the kanji is | What to do |
|---|---|
| In a Chrome tab (Meet, Teams web, Confluence, PDF…) | Press **Alt+Shift+K**, then drag a box around the text |
| In an app outside Chrome (Zoom, Teams desktop) | Press **⌘⌃⇧4** to copy a screenshot, then **⌘V** in the panel |
| You already have the text | Type or paste it into the input box |

You can also drag and drop an image file onto the panel.

### Results appear in the side panel

Not as an overlay on the page. When you share a single Chrome tab, only the tab content is transmitted — the side panel stays outside the captured area, while an on-page overlay would be visible to everyone in the meeting.

Each word shows its dictionary form, kana reading, romaji, Sino-Vietnamese reading, and English meaning. Expand **Từng chữ** at the bottom for a per-character breakdown, useful when OCR misreads a stroke or the word is not in the dictionary.

### Fixing OCR mistakes

The recognized text appears in an editable box above the results. Correct it and the word list updates as you type — one wrong stroke is enough to miss a word.

### Options

- **Hiện cả từ thuần kana** — also list pure-hiragana function words (particles, `する`, `なる`…). Off by default so the list stays focused on kanji.
- **Ảnh chỉ có một dòng** — switches OCR to single-line mode. Turn this on when you capture exactly one line; it is more accurate for that case.

### Changing the shortcut

Go to `chrome://extensions/shortcuts`. Clicking the toolbar icon opens the panel without starting a capture.

---

Dictionary data from [JMdict/KANJIDIC2](http://www.edrdg.org/) (EDRDG, CC BY-SA 4.0) and [Unihan](https://www.unicode.org/charts/unihan.html) (Unicode). OCR by [Tesseract](https://github.com/tesseract-ocr/tesseract) (Apache 2.0).
