# 🔮 Design Scanner

> **Extract, Inspect & Capture Any Website** — A powerful Chrome extension (Manifest V3) that pulls design tokens, detects tech stacks, picks colors, captures screenshots, inspects CSS, and downloads assets from any website in one click.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![JSZip](https://img.shields.io/badge/Powered%20by-JSZip-orange)](https://stuk.github.io/jszip/)
[![No CDN](https://img.shields.io/badge/Zero%20CDN%20Deps-✓-success)](https://github.com)

---

## ✨ Features

### 🎨 **Design Tokens**
Auto-extracts **colors, typography, font families, spacing scale, shadows, and border radius** from any page's computed styles. Click any swatch to copy. Export everything as a clean Markdown document.

### 🎯 **Color Picker**
Pixel-level eyedropper with a **live magnifier** and crosshair cursor. Copy HEX/RGB instantly. Keeps a history of recent picks across sessions. Press `Escape` to cancel.

### 📸 **Screenshot Capture**
Three powerful modes:
- **Visible Area** — One-click capture of the current viewport
- **Full Page** — Auto-scrolls, captures segments, and stitches them into a seamless long screenshot
- **Custom Region** — Blur overlay with drag-to-select any area of the page

Supports **PNG, JPG, WebP, and SVG** output. Download or copy to clipboard.

### 🧩 **CSS Inspector**
Hover over any element to see a live highlight and computed CSS preview. Click to **lock** the element and copy the full style block. Real-time tooltip follows your cursor.

### 📦 **Asset Export**
Lists every image (`<img>`), CSS background, and inline SVG on the page. Download individually or bundle everything into a **ZIP archive** with optional format conversion (PNG / JPG / WebP).

### 🔍 **Tech Stack Detection**
Automatically identifies **frameworks** (React, Vue, Angular, Svelte), **CMS** (WordPress, Shopify, Webflow), **analytics** (Google Analytics, Hotjar, Mixpanel), **CDNs**, and **UI libraries** from scripts, stylesheets, and DOM signatures.

---

## 🚀 Installation

### Method 1: Load Unpacked (Recommended for Development)

1. Open `chrome://extensions` in your browser
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `design-system-extractor` folder
5. Pin the extension to your toolbar

### Method 2: Direct Download

> Coming soon to the Chrome Web Store.

---

## 📖 Usage

Click the extension icon to open the popup. Five tabs put everything at your fingertips:

| Tab | What It Does | Hotkey |
|-----|-------------|--------|
| **Design** | Extracts colors, typography, fonts, spacing, shadows, and border radius. Click any swatch to copy. Use **Export .md** to download as Markdown. | — |
| **Colors** | Enable the pixel-perfect eyedropper. Hover to preview with magnifier, click to copy HEX. View history of recent picks. | `Escape` to disable |
| **Capture** | Capture visible area, full-page scroll, or a custom drag-to-select region. Choose format (PNG/JPG/WebP/SVG) and download or copy. | `Escape` to cancel region |
| **Inspect** | Hover any element to highlight and preview computed CSS. Click to lock styles. Copy the full CSS block. | — |
| **Assets** | Lists all images, backgrounds, and SVGs. Choose format per-image or globally. Download individually or as ZIP. | — |

---

## 🛠️ Permissions

| Permission | Why We Need It |
|-----------|----------------|
| `activeTab` | Access the current tab for design extraction, screenshots, and image listing |
| `scripting` | Inject the content script for the inspector, color picker, and region selector |
| `downloads` | Save screenshots and exported Markdown files to your computer |
| `clipboardWrite` | Copy colors, CSS, and screenshots directly to your clipboard |
| `<all_urls>` | Work on any website you visit (no domain restrictions) |

---

## 📁 File Structure

```
design-system-extractor/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker for offscreen stitching & region capture
├── content.js             # Content script (extraction, inspector, color picker, region selector)
├── popup.html             # Popup UI layout
├── popup.js               # Popup logic (tab rendering, messaging, download)
├── styles.css             # Popup styling (~935 lines)
├── landing.html           # Marketing landing page
├── icon16.png / icon48.png / icon128.png   # Extension icons
└── lib/
    ├── jszip.min.js       # JSZip — ZIP archive creation
    └── FileSaver.min.js   # FileSaver.js (bundled)
```

---

## 📸 Screenshots

> *Screenshots will be added here. The popup features a clean, modern interface with:*
> - 🎨 **Design** tab showing color swatches, typography cards, and spacing chips
> - 🎯 **Colors** tab with the live eyedropper and color history
> - 📸 **Capture** tab with mode selection and format dropdown
> - 🧩 **Inspect** tab with live CSS preview and copy button
> - 📦 **Assets** tab with image grid and ZIP download button

---

## 🧰 Libraries

| Library | Purpose | Size |
|---------|---------|------|
| [JSZip](https://stuk.github.io/jszip/) | Creating ZIP archives of downloaded images | ~95 KB |
| [FileSaver.js](https://github.com/eligrey/FileSaver.js/) | Programmatic file downloads (bundled) | ~12 KB |

**No external CDN dependencies.** Everything works offline.

---

## 🎯 Use Cases

- **Designers** auditing competitor sites for color palettes and typography
- **Developers** inspecting CSS without opening DevTools
- **QA Engineers** capturing full-page screenshots for bug reports
- **Marketers** downloading all image assets from a landing page
- **Researchers** documenting tech stacks and design patterns

---

## 📝 Changelog

### v1.2.0
- 🎨 Redesigned popup UI with modern tab layout
- 🎯 Added pixel-perfect color picker with magnifier
- 📸 Added custom region screenshot mode with blur overlay
- 🧩 Added live CSS inspector with hover highlights
- 📦 Added per-image format selection
- 🔍 Improved tech stack detection accuracy

### v1.1.0
- Added full-page screenshot stitching
- Added image format conversion (PNG/JPG/WebP)
- Added design system Markdown export

### v1.0.0
- Initial release with design token extraction, image download, and tech detection

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <img src="icon128.png" width="48" alt="Design Scanner">
  <br>
  <strong>Design Scanner</strong>
  <br>
  <sub>Made for designers who inspect. Built for developers who ship.</sub>
</p>
