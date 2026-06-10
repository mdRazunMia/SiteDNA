# Design System & Image Extractor

A Chrome extension (Manifest V3) that extracts design tokens, detects technologies, inspects elements, picks colors, captures screenshots, and downloads images from any website.

## Features

- **Design System Extraction** — Extracts colors, typography, fonts, spacing, shadows, and border radius from any page. Export as Markdown.
- **Technology Detection** — Detects frameworks (React, Vue, Angular, etc.), CMS (WordPress, Shopify, etc.), analytics, CDNs, and UI libraries used on the page.
- **Element Inspector** — Hover over any element to see its computed CSS (box model, typography, flexbox/grid, shadows, colors, etc.). Click to lock and copy the CSS.
- **Color Picker** — Pixel-level eyedropper with magnifier. Pick any color on screen, get HEX/RGB values, with a history of recent picks.
- **Image Download** — Lists all images (including CSS backgrounds and inline SVGs). Download individually or as a ZIP archive, with format conversion (PNG/JPG/WebP).
- **Screenshot Capture** — Capture visible area, full-page (auto-scroll & stitch), or custom region (click-and-drag selector).

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `design-system-extractor` directory

## Usage

Click the extension icon in the toolbar to open the popup. The popup has five tabs:

| Tab | What it does |
|-----|-------------|
| **Design System** | Extracts and displays design tokens. Click any swatch to copy its value. Use **Export .md** to download as Markdown. |
| **Color Picker** | Enable the eyedropper, hover over the page to sample colors. Click to lock a color. History persists across picks. |
| **Images** | Lists all images on the page. Choose format per-image or globally. Download individually or as ZIP. |
| **Inspector** | Hover elements to inspect their computed CSS. Click to lock styles. Copy the full CSS block. |
| **Screenshot** | Capture visible area, full-page scroll, or a custom region. Download or copy to clipboard. |

### Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `Escape` | Color Picker active | Disables picker |
| `Escape` | Region Selector active | Cancels selection |

## Permissions

| Permission | Reason |
|-----------|--------|
| `activeTab` | Access the current tab for design extraction, screenshots, and image listing |
| `scripting` | Inject content script for inspector, color picker, region selector |
| `downloads` | Save screenshots and exported Markdown files |
| `<all_urls>` | Work on any website the user visits |

## File Structure

```
├── manifest.json       Extension manifest (MV3)
├── background.js       Service worker (offscreen stitching, region capture)
├── content.js          Content script (design extraction, inspector, color picker, region selector)
├── popup.html          Popup UI layout
├── popup.js            Popup logic (tab rendering, messaging, capture)
├── styles.css          Popup styling (~935 lines)
├── icon16/48/128.png   Extension icons
└── lib/
    ├── jszip.min.js    JSZip — ZIP archive creation
    └── FileSaver.min.js FileSaver.js (bundled, not actively used)
```

## Libraries

| Library | Use |
|---------|-----|
| [JSZip](https://stuk.github.io/jszip/) | Creating ZIP archives of downloaded images |
| [FileSaver.js](https://github.com/eligrey/FileSaver.js/) | Bundled but downloads use programmatic `<a>` clicks |

No external CDN dependencies.

## License

MIT
