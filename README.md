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

---

Dictionary data from [JMdict/KANJIDIC2](http://www.edrdg.org/) (EDRDG, CC BY-SA 4.0) and [Unihan](https://www.unicode.org/charts/unihan.html) (Unicode). OCR by [Tesseract](https://github.com/tesseract-ocr/tesseract) (Apache 2.0).
