// Content script - runs in every page and extracts data on demand

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
  if (request.action === 'extractDesignSystem') {
    try {
      const data = extractDesignSystem();
      sendResponse({ success: true, data: data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'extractImages') {
    try {
      const data = extractImages();
      sendResponse({ success: true, data: data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'extractTechnologies') {
    try {
      const data = extractTechnologies();
      sendResponse({ success: true, data: data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'enableInspector') {
    try {
      enableInspector();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'disableInspector') {
    try {
      disableInspector();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'getPickedStyles') {
    sendResponse({ success: true, css: lastPickedCSS || '' });
  } else if (request.action === 'getInspectorState') {
    sendResponse({ success: true, active: inspectorActive, css: lastPickedCSS || '' });
  } else if (request.action === 'getPageDimensions') {
    const body = document.body;
    const html = document.documentElement;
    sendResponse({
      success: true,
      width: Math.max(body.scrollWidth, body.offsetWidth, html.scrollWidth, html.offsetWidth, html.clientWidth),
      height: Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight, html.clientHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    });
  } else if (request.action === 'scrollTo') {
    window.scrollTo(request.x, request.y);
    sendResponse({ success: true });
  } else if (request.action === 'startRegionSelect') {
    startRegionSelector(request.format || 'png');
    sendResponse({ success: true });
  } else if (request.action === 'stopRegionSelect') {
    stopRegionSelector();
    sendResponse({ success: true });
  } else if (request.action === 'enableColorPicker') {
    enableColorPicker().then(function() {
      sendResponse({ success: true });
    }).catch(function(err) {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  } else if (request.action === 'disableColorPicker') {
    try {
      disableColorPicker();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  } else if (request.action === 'getPickedColor') {
    sendResponse({ success: true, color: lastPickedColor || null });
  } else if (request.action === 'getPickerState') {
    sendResponse({ success: true, active: colorPickerActive });
  }
  return true; // Keep channel open for async
});

// ===== ELEMENT INSPECTOR =====

let inspectorActive = false;
let inspectorHighlight = null;
let inspectorTooltip = null;
let lastHoveredElement = null;
let lastPickedCSS = '';

const INSPECTOR_IGNORED = ['html', 'body', 'head', 'script', 'style', 'meta', 'link'];

function createInspectorTooltip() {
  if (inspectorTooltip) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'dsa-inspector-tooltip';
  tooltip.style.cssText = [
    'position:absolute',
    'z-index:2147483647',
    'background:#0f172a',
    'color:#f8fafc',
    'border:1px solid #334155',
    'border-radius:10px',
    'padding:12px',
    'font-family:"Segoe UI",system-ui,sans-serif',
    'font-size:12px',
    'line-height:1.5',
    'max-width:320px',
    'box-shadow:0 10px 30px rgba(0,0,0,0.3)',
    'pointer-events:auto',
    'display:none',
    'overflow:hidden'
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;';

  const title = document.createElement('span');
  title.textContent = 'Element Styles';
  title.style.cssText = 'font-weight:700;font-size:13px;color:#fff;';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy CSS';
  copyBtn.style.cssText = 'padding:3px 8px;background:#fff;color:#0f172a;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;';
  copyBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (lastPickedCSS) {
      navigator.clipboard.writeText(lastPickedCSS).catch(function(){});
      copyBtn.textContent = 'Copied!';
      setTimeout(function() { copyBtn.textContent = 'Copy CSS'; }, 1200);
    }
  });

  header.appendChild(title);
  header.appendChild(copyBtn);
  tooltip.appendChild(header);

  const content = document.createElement('pre');
  content.id = 'dsa-inspector-content';
  content.style.cssText = 'margin:0;padding:8px;background:#1e293b;border-radius:6px;font-family:"SF Mono",Monaco,monospace;font-size:11px;color:#cbd5e1;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow-y:auto;';
  tooltip.appendChild(content);

  document.body.appendChild(tooltip);
  inspectorTooltip = tooltip;
}

function createInspectorHighlight() {
  if (inspectorHighlight) return;
  const el = document.createElement('div');
  el.id = 'dsa-inspector-highlight';
  el.style.cssText = [
    'position:absolute',
    'z-index:2147483646',
    'pointer-events:none',
    'box-sizing:border-box',
    'border:2px dashed #38bdf8',
    'background:rgba(56,189,248,0.08)',
    'border-radius:4px',
    'display:none',
    'transition:all 0.08s ease-out'
  ].join(';');
  document.body.appendChild(el);
  inspectorHighlight = el;
}

function removeInspectorElements() {
  if (inspectorHighlight) {
    inspectorHighlight.remove();
    inspectorHighlight = null;
  }
  if (inspectorTooltip) {
    inspectorTooltip.remove();
    inspectorTooltip = null;
  }
}

function getSimpleSelector(el) {
  if (el.id) return '#' + el.id;
  let sel = el.tagName.toLowerCase();
  if (el.className && typeof el.className === 'string') {
    const cls = el.className.split(/\s+/).filter(function(c) { return c && !c.startsWith('dsa-inspector'); }).join('.');
    if (cls) sel += '.' + cls;
  }
  return sel;
}

function extractElementStyles(el) {
  const computed = window.getComputedStyle(el);
  const props = [
    'display', 'position', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'background-color', 'background-image', 'color',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius',
    'box-shadow', 'text-shadow',
    'opacity', 'overflow', 'z-index',
    'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-gap'
  ];

  var css = '/* ' + getSimpleSelector(el) + ' */\n';
  css += getSimpleSelector(el) + ' {\n';
  props.forEach(function(p) {
    var val = computed.getPropertyValue(p);
    if (val && val !== 'none' && val !== 'auto' && val !== 'normal' && val !== '0px' && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
      css += '  ' + p + ': ' + val + ';\n';
    }
  });
  css += '}';
  return css;
}

function updateInspectorHighlight(el) {
  if (!inspectorHighlight) return;
  const rect = el.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  inspectorHighlight.style.display = 'block';
  inspectorHighlight.style.left = (rect.left + scrollX) + 'px';
  inspectorHighlight.style.top = (rect.top + scrollY) + 'px';
  inspectorHighlight.style.width = rect.width + 'px';
  inspectorHighlight.style.height = rect.height + 'px';
}

function updateInspectorTooltip(el) {
  if (!inspectorTooltip) return;
  const rect = el.getBoundingClientRect();
  const css = extractElementStyles(el);
  lastPickedCSS = css;
  const content = inspectorTooltip.querySelector('#dsa-inspector-content');
  if (content) content.textContent = css;

  // Position tooltip near element but keep inside viewport
  const tooltipRect = inspectorTooltip.getBoundingClientRect();
  let left = rect.right + 12;
  let top = rect.top;
  if (left + 320 > window.innerWidth) {
    left = rect.left - 332;
  }
  if (left < 0) left = 12;
  if (top + 300 > window.innerHeight) {
    top = window.innerHeight - 300;
  }
  if (top < 0) top = 12;

  inspectorTooltip.style.left = (left + window.scrollX) + 'px';
  inspectorTooltip.style.top = (top + window.scrollY) + 'px';
  inspectorTooltip.style.display = 'block';
}

function onInspectorMouseOver(e) {
  if (!inspectorActive) return;
  const el = e.target;
  if (!el || el === document.body || el === document.documentElement) return;
  if (el.id && (el.id === 'dsa-inspector-tooltip' || el.id === 'dsa-inspector-highlight')) return;
  if (INSPECTOR_IGNORED.indexOf(el.tagName.toLowerCase()) !== -1) return;
  if (el.closest && el.closest('#dsa-inspector-tooltip')) return;

  lastHoveredElement = el;
  updateInspectorHighlight(el);
  updateInspectorTooltip(el);
}

function onInspectorClick(e) {
  if (!inspectorActive) return;
  if (e.target.closest && e.target.closest('#dsa-inspector-tooltip')) return;
  if (lastHoveredElement) {
    updateInspectorTooltip(lastHoveredElement);
    e.preventDefault();
    e.stopPropagation();
  }
}

function onInspectorScroll() {
  if (!inspectorActive || !lastHoveredElement) return;
  updateInspectorHighlight(lastHoveredElement);
  updateInspectorTooltip(lastHoveredElement);
}

function enableInspector() {
  if (inspectorActive) return;
  inspectorActive = true;
  createInspectorHighlight();
  createInspectorTooltip();
  document.addEventListener('mouseover', onInspectorMouseOver, true);
  document.addEventListener('click', onInspectorClick, true);
  window.addEventListener('scroll', onInspectorScroll, true);
}

function disableInspector() {
  if (!inspectorActive) return;
  inspectorActive = false;
  lastHoveredElement = null;
  document.removeEventListener('mouseover', onInspectorMouseOver, true);
  document.removeEventListener('click', onInspectorClick, true);
  window.removeEventListener('scroll', onInspectorScroll, true);
  removeInspectorElements();
}

// ===== REGION SELECTOR =====

let regionSelectorActive = false;
let regionOverlay = null;
let regionStartX = 0, regionStartY = 0;
let regionRect = null;
let regionFormat = 'png';

function createRegionOverlay() {
  if (regionOverlay) return;

  // Container holds all panels + label (no clip-path needed)
  const container = document.createElement('div');
  container.id = 'dsa-region-container';
  container.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'cursor:crosshair',
    'pointer-events:auto'
  ].join(';');

  // Create 4 blur/dark panels that frame the selection
  const panelBase = [
    'position:absolute',
    'background:rgba(0,0,0,0.4)',
    'backdrop-filter:blur(4px)'
  ].join(';');

  for (const id of ['dsa-panel-top', 'dsa-panel-bottom', 'dsa-panel-left', 'dsa-panel-right']) {
    const panel = document.createElement('div');
    panel.id = id;
    panel.style.cssText = panelBase;
    container.appendChild(panel);
  }

  const label = document.createElement('div');
  label.id = 'dsa-region-label';
  label.textContent = 'Click and drag to select a region';
  label.style.cssText = [
    'position:absolute',
    'top:50%',
    'left:50%',
    'transform:translate(-50%,-50%)',
    'color:#fff',
    'font-family:system-ui,sans-serif',
    'font-size:18px',
    'font-weight:600',
    'text-shadow:0 2px 8px rgba(0,0,0,0.5)',
    'pointer-events:none',
    'text-align:center',
    'line-height:1.4'
  ].join(';');
  container.appendChild(label);
  document.body.appendChild(container);

  // Selection border — sits in the clear gap between panels
  const border = document.createElement('div');
  border.id = 'dsa-region-border';
  border.style.cssText = [
    'position:fixed',
    'z-index:2147483648',
    'border:2px dashed #fff',
    'border-radius:4px',
    'display:none',
    'pointer-events:none',
    'box-sizing:border-box'
  ].join(';');

  const info = document.createElement('div');
  info.id = 'dsa-region-size';
  info.style.cssText = [
    'position:absolute',
    'bottom:-28px',
    'left:0',
    'background:#0f172a',
    'color:#f8fafc',
    'padding:3px 10px',
    'border-radius:4px',
    'font-family:monospace',
    'font-size:12px',
    'white-space:nowrap',
    'pointer-events:none'
  ].join(';');
  border.appendChild(info);
  document.body.appendChild(border);

  regionOverlay = { container, border };
}

function removeRegionOverlay() {
  if (regionOverlay) {
    regionOverlay.container.remove();
    regionOverlay.border.remove();
    regionOverlay = null;
  }
}

function updateOverlayPanels(x, y, w, h) {
  const c = regionOverlay?.container;
  if (!c) return;
  const x2 = x + w;
  const y2 = y + h;
  const iw = window.innerWidth;
  const ih = window.innerHeight;

  const top = c.querySelector('#dsa-panel-top');
  const bottom = c.querySelector('#dsa-panel-bottom');
  const left = c.querySelector('#dsa-panel-left');
  const right = c.querySelector('#dsa-panel-right');

  if (top)    top.style.cssText   = `position:absolute;top:0;left:0;width:100%;height:${y}px;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)`;
  if (bottom) bottom.style.cssText = `position:absolute;top:${y2}px;left:0;width:100%;height:${ih - y2}px;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)`;
  if (left)   left.style.cssText   = `position:absolute;top:${y}px;left:0;width:${x}px;height:${h}px;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)`;
  if (right)  right.style.cssText  = `position:absolute;top:${y}px;left:${x2}px;width:${iw - x2}px;height:${h}px;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)`;
}

function hideOverlayPanels() {
  const c = regionOverlay?.container;
  if (!c) return;
  for (const id of ['dsa-panel-top', 'dsa-panel-bottom', 'dsa-panel-left', 'dsa-panel-right']) {
    const p = c.querySelector('#' + id);
    if (p) p.style.cssText = 'position:absolute;display:none';
  }
}

function onRegionMouseDown(e) {
  if (!regionSelectorActive) return;
  regionStartX = e.clientX;
  regionStartY = e.clientY;
  regionRect = { x: regionStartX, y: regionStartY, width: 0, height: 0 };

  const label = document.getElementById('dsa-region-label');
  if (label) label.style.display = 'none';

  hideOverlayPanels();

  const border = document.getElementById('dsa-region-border');
  if (border) {
    border.style.display = 'block';
    border.style.left = regionStartX + 'px';
    border.style.top = regionStartY + 'px';
    border.style.width = '0px';
    border.style.height = '0px';
  }
}

function onRegionMouseMove(e) {
  if (!regionSelectorActive || !regionRect) return;
  const x = Math.min(regionStartX, e.clientX);
  const y = Math.min(regionStartY, e.clientY);
  const w = Math.abs(e.clientX - regionStartX);
  const h = Math.abs(e.clientY - regionStartY);

  regionRect = { x, y, width: w, height: h };

  // Position the four blur panels around the selection so the selected area stays clear
  updateOverlayPanels(x, y, w, h);

  const border = document.getElementById('dsa-region-border');
  if (border) {
    border.style.left = x + 'px';
    border.style.top = y + 'px';
    border.style.width = w + 'px';
    border.style.height = h + 'px';
    const info = border.querySelector('#dsa-region-size');
    if (info) info.textContent = w + ' \u00d7 ' + h;
  }
}

async function onRegionMouseUp(e) {
  if (!regionSelectorActive || !regionRect || regionRect.width < 5 || regionRect.height < 5) {
    regionRect = null;
    return;
  }

  const r = regionRect;
  const region = {
    x: r.x + window.scrollX,
    y: r.y + window.scrollY,
    width: r.width,
    height: r.height,
    viewportX: r.x,
    viewportY: r.y,
    viewportWidth: r.width,
    viewportHeight: r.height
  };

  const dims = {
    width: Math.max(document.body.scrollWidth, document.body.offsetWidth, document.documentElement.scrollWidth, document.documentElement.offsetWidth, document.documentElement.clientWidth),
    height: Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight, document.documentElement.clientHeight),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1
  };

  const border = document.getElementById('dsa-region-border');
  if (border) {
    const info = border.querySelector('#dsa-region-size');
    if (info) info.textContent = r.width + ' \u00d7 ' + r.height + ' \u2014 Capturing...';
  }

  stopRegionSelector();
  // Let the overlay disappear before capture
  await new Promise(r => setTimeout(r, 100));

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'captureRegion', region, dims, format: regionFormat });
    if (resp && resp.success && resp.dataUrl) {
      showRegionResult(resp.dataUrl, r.width, r.height, regionFormat);
    } else {
      showRegionToast('Capture failed: ' + (resp ? resp.error : 'No response'), 'error');
    }
  } catch (err) {
    showRegionToast('Capture failed: ' + err.message, 'error');
  }
}

function showRegionResult(dataUrl, w, h, format) {
  const ext = format || 'png';
  const toolbar = document.createElement('div');
  toolbar.id = 'dsa-region-result';
  toolbar.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'background:#0f172a',
    'color:#f8fafc',
    'padding:12px 20px',
    'border-radius:12px',
    'font-family:system-ui,sans-serif',
    'font-size:14px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.3)',
    'animation:dsaFadeIn 0.25s ease-out'
  ].join(';');

  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = w + ' \u00d7 ' + h + ' px';
  sizeLabel.style.cssText = 'font-weight:600;color:#94a3b8;margin-right:4px;';

  const btnDl = document.createElement('button');
  btnDl.textContent = 'Download';
  btnDl.style.cssText = 'padding:7px 16px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  btnDl.addEventListener('click', function(e) {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'region-' + w + 'x' + h + '.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  const btnCopy = document.createElement('button');
  btnCopy.textContent = 'Copy';
  btnCopy.style.cssText = 'padding:7px 16px;background:#334155;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';
  btnCopy.addEventListener('click', async function(e) {
    e.stopPropagation();
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      btnCopy.textContent = 'Copied!';
      setTimeout(function() { btnCopy.textContent = 'Copy'; }, 1500);
    } catch {
      btnCopy.textContent = 'Failed';
      setTimeout(function() { btnCopy.textContent = 'Copy'; }, 1500);
    }
  });

  const btnClose = document.createElement('button');
  btnClose.innerHTML = '\u2715';
  btnClose.style.cssText = 'padding:4px 8px;background:transparent;color:#64748b;border:none;border-radius:4px;font-size:16px;cursor:pointer;margin-left:4px;';
  btnClose.addEventListener('click', function() {
    toolbar.remove();
    const style = document.getElementById('dsa-region-style');
    if (style) style.remove();
  });

  toolbar.appendChild(sizeLabel);
  toolbar.appendChild(btnDl);
  toolbar.appendChild(btnCopy);
  toolbar.appendChild(btnClose);
  document.body.appendChild(toolbar);

  // Inject keyframe animation
  if (!document.getElementById('dsa-region-style')) {
    const style = document.createElement('style');
    style.id = 'dsa-region-style';
    style.textContent = '@keyframes dsaFadeIn { from { opacity:0; transform:translateX(-50%) translateY(16px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }';
    document.head.appendChild(style);
  }
}

function showRegionToast(msg, type) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = [
    'position:fixed',
    'top:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'padding:' + (type === 'error' ? '10px 20px' : '10px 20px'),
    'background:' + (type === 'error' ? '#fef2f2' : '#f0fdf4'),
    'color:' + (type === 'error' ? '#991b1b' : '#166534'),
    'border-radius:' + (type === 'error' ? '8px' : '8px'),
    'font-family:system-ui,sans-serif',
    'font-size:14px',
    'font-weight:600',
    'box-shadow:0 4px 16px rgba(0,0,0,0.15)',
    'animation:dsaFadeIn 0.2s ease-out'
  ].join(';');
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

function showPickerToast(msg) {
  if (!document.getElementById('dsa-region-style')) {
    var style = document.createElement('style');
    style.id = 'dsa-region-style';
    style.textContent = '@keyframes dsaFadeIn { from { opacity:0; transform:translateX(-50%) translateY(16px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }';
    document.head.appendChild(style);
  }
  const existing = document.getElementById('dsa-cp-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'dsa-cp-toast';
  toast.textContent = msg;
  toast.style.cssText = [
    'position:fixed',
    'top:24px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'padding:10px 20px',
    'background:#0f172a',
    'color:#f8fafc',
    'border:1px solid #334155',
    'border-radius:10px',
    'font-family:system-ui,sans-serif',
    'font-size:14px',
    'font-weight:600',
    'box-shadow:0 8px 32px rgba(0,0,0,0.3)',
    'animation:dsaFadeIn 0.2s ease-out'
  ].join(';');
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 2000);
}

function onRegionKeyDown(e) {
  if (!regionSelectorActive) return;
  if (e.key === 'Escape') {
    stopRegionSelector();
  }
}

function startRegionSelector(format) {
  if (regionSelectorActive) return;
  regionFormat = format || 'png';
  regionSelectorActive = true;
  regionRect = null;
  createRegionOverlay();
  document.addEventListener('mousedown', onRegionMouseDown, true);
  document.addEventListener('mousemove', onRegionMouseMove, true);
  document.addEventListener('mouseup', onRegionMouseUp, true);
  document.addEventListener('keydown', onRegionKeyDown, true);
}

function stopRegionSelector() {
  if (!regionSelectorActive) return;
  regionSelectorActive = false;
  regionRect = null;
  document.removeEventListener('mousedown', onRegionMouseDown, true);
  document.removeEventListener('mousemove', onRegionMouseMove, true);
  document.removeEventListener('mouseup', onRegionMouseUp, true);
  document.removeEventListener('keydown', onRegionKeyDown, true);
  removeRegionOverlay();
}

// ===== COLOR PICKER (Pixel-level eyedropper) =====

let colorPickerActive = false;
let colorPickerTooltip = null;
let colorPickerCanvas = null;
let colorPickerCtx = null;
let lastPickedColor = null;
let colorHistory = [];

function createPickerTooltip() {
  if (colorPickerTooltip) return;
  const el = document.createElement('div');
  el.id = 'dsa-cp-tooltip';
  el.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'background:#0f172a',
    'color:#f8fafc',
    'border:1px solid #334155',
    'border-radius:12px',
    'padding:12px',
    'font-family:"Segoe UI",system-ui,sans-serif',
    'font-size:12px',
    'box-shadow:0 10px 30px rgba(0,0,0,0.4)',
    'pointer-events:none',
    'display:none',
    'width:200px'
  ].join(';');

  // Inner: magnifier preview + color info
  el.innerHTML = '<div style="display:flex;align-items:center;gap:12px;">' +
    '<div id="dsa-cp-magnifier" style="width:44px;height:44px;border-radius:8px;border:2px solid #334155;overflow:hidden;flex-shrink:0;position:relative;">' +
      '<canvas id="dsa-cp-mag-canvas" width="44" height="44" style="display:block;image-rendering:pixelated"></canvas>' +
      '<div style="position:absolute;top:50%;left:50%;width:2px;height:2px;margin:-1px 0 0 -1px;background:rgba(255,255,255,0.8);border:1px solid rgba(0,0,0,0.4);border-radius:50%"></div>' +
    '</div>' +
    '<div style="flex:1;min-width:0;">' +
      '<div id="dsa-cp-hex" style="font-weight:700;font-family:monospace;font-size:15px;color:#fff">#000000</div>' +
      '<div id="dsa-cp-rgb" style="font-size:10px;color:#94a3b8;font-family:monospace;margin-top:1px;">rgb(0,0,0)</div>' +
    '</div>' +
  '</div>';

  document.body.appendChild(el);
  colorPickerTooltip = el;
}

function removePickerElements() {
  if (colorPickerTooltip) { colorPickerTooltip.remove(); colorPickerTooltip = null; }
  colorPickerCanvas = null;
  colorPickerCtx = null;
}

function toHex(color) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle;
  if (normalized.charAt(0) === '#') return normalized;
  const rgb = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) return color;
  const r = parseInt(rgb[1], 10);
  const g = parseInt(rgb[2], 10);
  const b = parseInt(rgb[3], 10);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function samplePixel(clientX, clientY) {
  if (!colorPickerCtx) return null;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(clientX * dpr);
  const py = Math.round(clientY * dpr);

  // Constrain to canvas bounds
  const w = colorPickerCanvas.width;
  const h = colorPickerCanvas.height;
  if (px < 0 || py < 0 || px >= w || py >= h) return null;

  const data = colorPickerCtx.getImageData(px, py, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2], hex: rgbToHex(data[0], data[1], data[2]) };
}

function updateMagnifier(clientX, clientY) {
  const magCanvas = document.getElementById('dsa-cp-mag-canvas');
  if (!magCanvas || !colorPickerCtx) return;
  const magCtx = magCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 11; // 11x11 pixel block
  const cx = Math.round(clientX * dpr);
  const cy = Math.round(clientY * dpr);
  const hw = Math.floor(size / 2);
  const sx = Math.max(0, cx - hw);
  const sy = Math.max(0, cy - hw);
  const sw = Math.min(size, colorPickerCanvas.width - sx);
  const sh = Math.min(size, colorPickerCanvas.height - sy);
  magCtx.imageSmoothingEnabled = false;
  magCtx.clearRect(0, 0, 44, 44);
  magCtx.drawImage(colorPickerCanvas, sx, sy, sw, sh, 0, 0, 44, 44);
}

function updatePickerTooltip(clientX, clientY, pixel) {
  if (!colorPickerTooltip || !pixel) {
    if (colorPickerTooltip) colorPickerTooltip.style.display = 'none';
    return;
  }
  document.getElementById('dsa-cp-hex').textContent = pixel.hex;
  document.getElementById('dsa-cp-rgb').textContent = 'rgb(' + pixel.r + ', ' + pixel.g + ', ' + pixel.b + ')';
  updateMagnifier(clientX, clientY);

  const tipW = 224;
  let left = clientX + 16;
  let top = clientY - 30;
  if (left + tipW > window.innerWidth - 8) left = clientX - tipW - 16;
  if (top < 8) top = 8;
  if (top + 80 > window.innerHeight) top = window.innerHeight - 88;
  colorPickerTooltip.style.left = left + 'px';
  colorPickerTooltip.style.top = top + 'px';
  colorPickerTooltip.style.display = 'block';
}

function onPickerMouseMove(e) {
  if (!colorPickerActive) return;
  const pixel = samplePixel(e.clientX, e.clientY);
  updatePickerTooltip(e.clientX, e.clientY, pixel);
}

function onPickerClick(e) {
  if (!colorPickerActive) return;
  // Ignore clicks on the tooltip and its children
  const tooltip = document.getElementById('dsa-cp-tooltip');
  if (tooltip && tooltip.contains(e.target)) return;
  if (e.target && e.target.closest && e.target.closest('#dsa-cp-tooltip')) return;
  const pixel = samplePixel(e.clientX, e.clientY);
  if (!pixel) return;

  // Copy color to clipboard using execCommand (most reliable in content scripts)
  var textarea = document.createElement('textarea');
  textarea.value = pixel.hex;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.zIndex = '-1';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (err) {}
  document.body.removeChild(textarea);
  showPickerToast('Copied ' + pixel.hex + '!');

  lastPickedColor = { hex: pixel.hex, rgb: 'rgb(' + pixel.r + ', ' + pixel.g + ', ' + pixel.b + ')', role: 'Pixel' };
  if (!colorHistory.find(function(c) { return c.hex === pixel.hex; })) {
    colorHistory.unshift(lastPickedColor);
    if (colorHistory.length > 20) colorHistory.pop();
  }

  e.preventDefault();
  e.stopPropagation();
  // Auto-disable picker after picking a color so cursor is released
  disableColorPicker();
}

function onPickerKeyDown(e) {
  if (!colorPickerActive) return;
  if (e.key === 'Escape') {
    disableColorPicker();
  }
}

function onPickerScroll() {
  if (!colorPickerActive) return;
  // Re-capture viewport when user scrolls to keep pixel data in sync
  recaptureViewport();
}

async function recaptureViewport() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'captureViewport' });
    if (!resp || !resp.success || !resp.dataUrl) return;
    const img = new Image();
    await new Promise(function(resolve, reject) {
      img.onload = resolve;
      img.onerror = reject;
      img.src = resp.dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    colorPickerCanvas = canvas;
    colorPickerCtx = ctx;
  } catch (e) {
    // ignore
  }
}

async function enableColorPicker() {
  if (colorPickerActive) return;

  // Capture the visible viewport via background
  let dataUrl;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'captureViewport' });
    if (!resp || !resp.success || !resp.dataUrl) throw new Error('Capture failed');
    dataUrl = resp.dataUrl;
  } catch (err) {
    console.error('Color picker: viewport capture failed', err);
    return;
  }

  // Draw screenshot onto a hidden canvas for pixel sampling
  const img = new Image();
  await new Promise(function(resolve, reject) {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  colorPickerCanvas = canvas;
  colorPickerCtx = ctx;

  // Create tooltip and overlay
  createPickerTooltip();
  document.body.style.cursor = 'crosshair';

  colorPickerActive = true;
  document.addEventListener('mousemove', onPickerMouseMove, true);
  document.addEventListener('click', onPickerClick, true);
  document.addEventListener('keydown', onPickerKeyDown, true);
  window.addEventListener('scroll', onPickerScroll, true);
}

function disableColorPicker() {
  if (!colorPickerActive) return;
  colorPickerActive = false;
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', onPickerMouseMove, true);
  document.removeEventListener('click', onPickerClick, true);
  document.removeEventListener('keydown', onPickerKeyDown, true);
  window.removeEventListener('scroll', onPickerScroll, true);
  removePickerElements();
}

// ===== DESIGN SYSTEM EXTRACTION =====

// ===== DESIGN SYSTEM EXTRACTION =====

function extractDesignSystem() {
  function isValidColor(val) {
    return val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent' && val !== 'initial' && val !== 'inherit';
  }

  function addColor(map, value, role) {
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(role);
  }

  function getDominantRole(roles) {
    const counts = {};
    roles.forEach(function(r) { counts[r] = (counts[r] || 0) + 1; });
    let max = 0;
    let dom = 'accent';
    for (const r in counts) {
      if (counts[r] > max) { max = counts[r]; dom = r; }
    }
    return dom;
  }

  const colors = new Map();
  const fonts = new Set();
  const typography = [];
  const spacing = new Set();
  const shadows = new Set();
  const radius = new Set();

  const elements = document.querySelectorAll('body, body *');

  elements.forEach(function(el) {
    const style = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    const colorVal = style.color;
    if (isValidColor(colorVal)) addColor(colors, colorVal, 'text');
    const bgVal = style.backgroundColor;
    if (isValidColor(bgVal)) addColor(colors, bgVal, 'background');
    const borderVal = style.borderTopColor || style.borderColor;
    if (isValidColor(borderVal)) addColor(colors, borderVal, 'border');

    const fontFamily = style.fontFamily;
    if (fontFamily) {
      fontFamily.split(',').forEach(function(f) {
        const clean = f.trim().replace(/["']/g, '');
        if (clean && !/^(inherit|initial|unset|serif|sans-serif|monospace|cursive|fantasy)$/.test(clean)) {
          fonts.add(clean);
        }
      });
    }

    if (['h1','h2','h3','h4','h5','h6','p','a','button','label','span','div','li','td','th','small','strong','em'].indexOf(tag) !== -1) {
      const key = tag + '-' + style.fontSize + '-' + style.fontWeight + '-' + style.fontFamily;
      const exists = typography.some(function(t) { return t._key === key; });
      if (!exists) {
        typography.push({
          _key: key,
          tag: tag,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          fontFamily: style.fontFamily,
          color: style.color
        });
      }
    }

    ['margin', 'padding'].forEach(function(prop) {
      ['Top', 'Right', 'Bottom', 'Left'].forEach(function(side) {
        const val = style[prop + side];
        if (val && val !== '0px') spacing.add(val);
      });
    });

    const boxShadow = style.boxShadow;
    if (boxShadow && boxShadow !== 'none') shadows.add(boxShadow);
    const textShadow = style.textShadow;
    if (textShadow && textShadow !== 'none') shadows.add(textShadow);

    const borderRadius = style.borderRadius;
    if (borderRadius && borderRadius !== '0px') radius.add(borderRadius);
  });

  const colorArray = Array.from(colors.entries())
    .map(function(entry) {
      return { value: entry[0], role: getDominantRole(entry[1]), count: entry[1].length };
    })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 80);

  const spacingArray = Array.from(spacing).sort(function(a, b) {
    return parseFloat(a) - parseFloat(b);
  }).slice(0, 50);

  return {
    colors: colorArray,
    fonts: Array.from(fonts).slice(0, 30),
    typography: typography.slice(0, 40),
    spacing: spacingArray,
    shadows: Array.from(shadows).slice(0, 30),
    radius: Array.from(radius).slice(0, 30)
  };
}

// ===== IMAGE EXTRACTION =====

function extractImages() {
  const images = [];
  const seen = new Set();

  document.querySelectorAll('img').forEach(function(img) {
    if (img.src && !seen.has(img.src)) {
      seen.add(img.src);
      const ext = (img.src.split('.').pop().split('?')[0].toLowerCase()) || 'png';
      images.push({ src: img.src, ext: ext });
    }
  });

  document.querySelectorAll('*').forEach(function(el) {
    const style = window.getComputedStyle(el);
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const match = bgImage.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1] && !seen.has(match[1])) {
        seen.add(match[1]);
        const src = match[1].startsWith('http') ? match[1] : new URL(match[1], document.baseURI).href;
        const ext = (src.split('.').pop().split('?')[0].toLowerCase()) || 'png';
        images.push({ src: src, ext: ext });
      }
    }
  });

  document.querySelectorAll('svg').forEach(function(svg) {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
    if (!seen.has(dataUrl)) {
      seen.add(dataUrl);
      images.push({ src: dataUrl, ext: 'svg' });
    }
  });

  return images.slice(0, 200);
}

// ===== TECHNOLOGY DETECTION =====

function extractTechnologies() {
  const found = [];
  const scripts = [];
  const metaInfo = [];
  const seen = new Set();

  function add(name, category, confidence) {
    if (!seen.has(name)) {
      seen.add(name);
      found.push({ name: name, category: category, confidence: confidence });
    }
  }

  document.querySelectorAll('script[src]').forEach(function(s) {
    const src = s.src.toLowerCase();
    scripts.push(src);

    if (src.indexOf('react') !== -1 || src.indexOf('react-dom') !== -1) add('React', 'Framework', 'high');
    if (src.indexOf('vue') !== -1) add('Vue.js', 'Framework', 'high');
    if (src.indexOf('angular') !== -1) add('Angular', 'Framework', 'high');
    if (src.indexOf('svelte') !== -1) add('Svelte', 'Framework', 'high');
    if (src.indexOf('preact') !== -1) add('Preact', 'Framework', 'high');
    if (src.indexOf('jquery') !== -1) add('jQuery', 'JavaScript Library', 'high');
    if (src.indexOf('lodash') !== -1) add('Lodash', 'JavaScript Library', 'high');
    if (src.indexOf('moment') !== -1) add('Moment.js', 'JavaScript Library', 'high');
    if (src.indexOf('dayjs') !== -1) add('Day.js', 'JavaScript Library', 'high');
    if (src.indexOf('axios') !== -1) add('Axios', 'JavaScript Library', 'high');
    if (src.indexOf('gsap') !== -1) add('GSAP', 'JavaScript Library', 'high');
    if (src.indexOf('three') !== -1) add('Three.js', 'JavaScript Library', 'high');
    if (src.indexOf('d3') !== -1) add('D3.js', 'JavaScript Library', 'high');
    if (src.indexOf('chart') !== -1) add('Chart.js', 'JavaScript Library', 'medium');
    if (src.indexOf('swiper') !== -1) add('Swiper', 'JavaScript Library', 'high');
    if (src.indexOf('select2') !== -1) add('Select2', 'JavaScript Library', 'high');
    if (src.indexOf('bootstrap') !== -1 && src.indexOf('js') !== -1) add('Bootstrap JS', 'UI Framework', 'high');
    if (src.indexOf('foundation') !== -1) add('Foundation', 'UI Framework', 'high');
    if (src.indexOf('semantic') !== -1) add('Semantic UI', 'UI Framework', 'high');
    if (src.indexOf('materialize') !== -1) add('Materialize', 'UI Framework', 'high');
    if (src.indexOf('bulma') !== -1) add('Bulma', 'CSS Framework', 'high');
    if (src.indexOf('tailwind') !== -1) add('Tailwind CSS', 'CSS Framework', 'high');
    if (src.indexOf('windicss') !== -1) add('Windi CSS', 'CSS Framework', 'high');
    if (src.indexOf('unocss') !== -1) add('UnoCSS', 'CSS Framework', 'high');
    if (src.indexOf('styled-components') !== -1) add('Styled Components', 'CSS Framework', 'high');
    if (src.indexOf('emotion') !== -1) add('Emotion', 'CSS Framework', 'high');

    if (src.indexOf('wp-content') !== -1 || src.indexOf('wp-includes') !== -1) add('WordPress', 'CMS', 'high');
    if (src.indexOf('shopify') !== -1) add('Shopify', 'Ecommerce', 'high');
    if (src.indexOf('bigcommerce') !== -1) add('BigCommerce', 'Ecommerce', 'high');
    if (src.indexOf('magento') !== -1) add('Magento', 'Ecommerce', 'high');
    if (src.indexOf('wix') !== -1) add('Wix', 'CMS', 'high');
    if (src.indexOf('squarespace') !== -1) add('Squarespace', 'CMS', 'high');
    if (src.indexOf('webflow') !== -1) add('Webflow', 'CMS', 'high');
    if (src.indexOf('ghost') !== -1) add('Ghost', 'CMS', 'high');
    if (src.indexOf('hubspot') !== -1) add('HubSpot', 'CMS', 'high');
    if (src.indexOf('drupal') !== -1) add('Drupal', 'CMS', 'high');
    if (src.indexOf('joomla') !== -1) add('Joomla', 'CMS', 'high');

    if (src.indexOf('google-analytics') !== -1 || src.indexOf('googletagmanager') !== -1 || src.indexOf('gtm') !== -1) add('Google Analytics', 'Analytics', 'high');
    if (src.indexOf('gtag') !== -1) add('Google Tag Manager', 'Analytics', 'high');
    if (src.indexOf('hotjar') !== -1) add('Hotjar', 'Analytics', 'high');
    if (src.indexOf('mixpanel') !== -1) add('Mixpanel', 'Analytics', 'high');
    if (src.indexOf('segment') !== -1) add('Segment', 'Analytics', 'high');
    if (src.indexOf('amplitude') !== -1) add('Amplitude', 'Analytics', 'high');
    if (src.indexOf('plausible') !== -1) add('Plausible', 'Analytics', 'high');
    if (src.indexOf('fathom') !== -1) add('Fathom', 'Analytics', 'high');
    if (src.indexOf('matomo') !== -1 || src.indexOf('piwik') !== -1) add('Matomo', 'Analytics', 'high');
    if (src.indexOf('clarity') !== -1) add('Microsoft Clarity', 'Analytics', 'high');
    if (src.indexOf('intercom') !== -1) add('Intercom', 'Analytics', 'high');
    if (src.indexOf('crisp') !== -1) add('Crisp', 'Analytics', 'high');
    if (src.indexOf('tawk') !== -1) add('Tawk.to', 'Analytics', 'high');
    if (src.indexOf('zendesk') !== -1) add('Zendesk', 'Analytics', 'high');
    if (src.indexOf('freshchat') !== -1) add('Freshchat', 'Analytics', 'high');
    if (src.indexOf('livechat') !== -1) add('LiveChat', 'Analytics', 'high');
    if (src.indexOf('facebook') !== -1 && src.indexOf('pixel') !== -1) add('Facebook Pixel', 'Analytics', 'high');
    if (src.indexOf('twitter') !== -1 && src.indexOf('pixel') !== -1) add('Twitter Pixel', 'Analytics', 'high');
    if (src.indexOf('linkedin') !== -1 && src.indexOf('insight') !== -1) add('LinkedIn Insight', 'Analytics', 'high');
    if (src.indexOf('pinterest') !== -1) add('Pinterest Tag', 'Analytics', 'high');
    if (src.indexOf('tiktok') !== -1 && src.indexOf('pixel') !== -1) add('TikTok Pixel', 'Analytics', 'high');

    if (src.indexOf('cloudfront') !== -1) add('Amazon CloudFront', 'CDN', 'high');
    if (src.indexOf('cloudflare') !== -1) add('Cloudflare', 'CDN', 'high');
    if (src.indexOf('jsdelivr') !== -1) add('jsDelivr', 'CDN', 'high');
    if (src.indexOf('unpkg') !== -1) add('unpkg', 'CDN', 'high');
    if (src.indexOf('cdnjs') !== -1) add('cdnjs', 'CDN', 'high');
    if (src.indexOf('googleapis') !== -1) add('Google APIs', 'CDN', 'high');
    if (src.indexOf('fastly') !== -1) add('Fastly', 'CDN', 'high');
    if (src.indexOf('akamai') !== -1) add('Akamai', 'CDN', 'high');
    if (src.indexOf('vercel') !== -1) add('Vercel', 'CDN', 'high');
    if (src.indexOf('netlify') !== -1) add('Netlify', 'CDN', 'high');
    if (src.indexOf('firebase') !== -1) add('Firebase', 'CDN', 'high');
  });

  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(link) {
    const href = link.href.toLowerCase();
    scripts.push(href);
    if (href.indexOf('bootstrap') !== -1) add('Bootstrap', 'UI Framework', 'high');
    if (href.indexOf('tailwind') !== -1) add('Tailwind CSS', 'CSS Framework', 'high');
    if (href.indexOf('bulma') !== -1) add('Bulma', 'CSS Framework', 'high');
    if (href.indexOf('foundation') !== -1) add('Foundation', 'UI Framework', 'high');
    if (href.indexOf('semantic') !== -1) add('Semantic UI', 'UI Framework', 'high');
    if (href.indexOf('materialize') !== -1) add('Materialize', 'UI Framework', 'high');
    if (href.indexOf('material') !== -1 && href.indexOf('design') !== -1) add('Material Design', 'UI Framework', 'high');
    if (href.indexOf('spectre') !== -1) add('Spectre.css', 'CSS Framework', 'high');
    if (href.indexOf('purecss') !== -1 || href.indexOf('pure.css') !== -1) add('Pure.css', 'CSS Framework', 'high');
    if (href.indexOf('skeleton') !== -1) add('Skeleton', 'CSS Framework', 'high');
    if (href.indexOf('tachyons') !== -1) add('Tachyons', 'CSS Framework', 'high');
    if (href.indexOf('windicss') !== -1) add('Windi CSS', 'CSS Framework', 'high');
    if (href.indexOf('unocss') !== -1) add('UnoCSS', 'CSS Framework', 'high');
    if (href.indexOf('normalize') !== -1) add('Normalize.css', 'CSS Framework', 'high');
    if (href.indexOf('reset') !== -1) add('CSS Reset', 'CSS Framework', 'medium');
    if (href.indexOf('animate') !== -1) add('Animate.css', 'CSS Framework', 'high');
    if (href.indexOf('fontawesome') !== -1) add('Font Awesome', 'Font Scripts', 'high');
    if (href.indexOf('google') !== -1 && href.indexOf('fonts') !== -1) add('Google Fonts', 'Font Scripts', 'high');
    if (href.indexOf('typekit') !== -1 || (href.indexOf('adobe') !== -1 && href.indexOf('fonts') !== -1)) add('Adobe Fonts', 'Font Scripts', 'high');
  });

  document.querySelectorAll('meta').forEach(function(meta) {
    const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
    const content = meta.getAttribute('content') || '';
    if (name && content) metaInfo.push({ name: name, value: content });
    if (name === 'generator') {
      const gen = content.toLowerCase();
      if (gen.indexOf('wordpress') !== -1) add('WordPress', 'CMS', 'high');
      if (gen.indexOf('drupal') !== -1) add('Drupal', 'CMS', 'high');
      if (gen.indexOf('joomla') !== -1) add('Joomla', 'CMS', 'high');
      if (gen.indexOf('shopify') !== -1) add('Shopify', 'Ecommerce', 'high');
      if (gen.indexOf('squarespace') !== -1) add('Squarespace', 'CMS', 'high');
      if (gen.indexOf('wix') !== -1) add('Wix', 'CMS', 'high');
      if (gen.indexOf('webflow') !== -1) add('Webflow', 'CMS', 'high');
      if (gen.indexOf('ghost') !== -1) add('Ghost', 'CMS', 'high');
      if (gen.indexOf('gatsby') !== -1) add('Gatsby', 'Framework', 'high');
      if (gen.indexOf('next') !== -1) add('Next.js', 'Framework', 'high');
      if (gen.indexOf('nuxt') !== -1) add('Nuxt.js', 'Framework', 'high');
      if (gen.indexOf('hugo') !== -1) add('Hugo', 'Framework', 'high');
      if (gen.indexOf('jekyll') !== -1) add('Jekyll', 'Framework', 'high');
      if (gen.indexOf('astro') !== -1) add('Astro', 'Framework', 'high');
    }
    if (name === 'twitter:card' || name === 'twitter:site') add('Twitter Cards', 'Widget', 'high');
    if (name.indexOf('fb') !== -1 || name.indexOf('facebook') !== -1) add('Facebook SDK', 'Widget', 'high');
    if (name.indexOf('og:') !== -1) add('Open Graph', 'Widget', 'high');
  });

  const html = document.documentElement.innerHTML.substring(0, 50000).toLowerCase();
  const bodyClasses = document.body ? document.body.className.toLowerCase() : '';

  if (document.querySelector('[data-reactroot], [data-reactid], [data-react-checksum]')) add('React', 'Framework', 'high');
  if (document.querySelector('[data-v-app], [data-v-]') || document.querySelector('.__vue__') || document.querySelector('#__vue__')) add('Vue.js', 'Framework', 'high');
  if (document.querySelector('[ng-app], [ng-controller], [ng-model], [ng-bind], [ng-repeat], [ng-if], [ng-show]')) add('AngularJS', 'Framework', 'high');
  if (document.querySelector('[ng-version]')) add('Angular', 'Framework', 'high');
  if (html.indexOf('svelte-') !== -1) add('Svelte', 'Framework', 'high');
  if (html.indexOf('__webpack_') !== -1 || html.indexOf('webpackJsonp') !== -1 || html.indexOf('webpackChunk') !== -1) add('Webpack', 'Miscellaneous', 'high');
  if (html.indexOf('__next') !== -1) add('Next.js', 'Framework', 'high');
  if (html.indexOf('__nuxt') !== -1) add('Nuxt.js', 'Framework', 'high');
  if (html.indexOf('__gatsby') !== -1) add('Gatsby', 'Framework', 'high');
  if (html.indexOf('__astro') !== -1) add('Astro', 'Framework', 'high');
  if (bodyClasses.indexOf('wordpress') !== -1 || bodyClasses.indexOf('wp-') !== -1 || html.indexOf('wp-content') !== -1) add('WordPress', 'CMS', 'high');
  if (html.indexOf('shopify') !== -1 || bodyClasses.indexOf('shopify') !== -1) add('Shopify', 'Ecommerce', 'high');
  if (html.indexOf('w-inline-block') !== -1 || html.indexOf('w-container') !== -1 || html.indexOf('w-nav') !== -1) add('Webflow', 'CMS', 'high');
  if (html.indexOf('wix') !== -1 || html.indexOf('x-wix') !== -1) add('Wix', 'CMS', 'high');

  const allClasses = document.querySelectorAll('[class]');
  const hasTailwind = Array.from(allClasses).some(function(el) {
    const c = el.className;
    return /\b(flex|grid|bg-|text-|p-|m-|w-|h-|rounded|shadow|border|hover:|focus:|md:|lg:|xl:)\b/.test(c);
  });
  if (hasTailwind) add('Tailwind CSS', 'CSS Framework', 'medium');

  const hasBootstrap = Array.from(allClasses).some(function(el) {
    const c = el.className;
    return /\b(container|row|col-md|col-lg|btn-primary|navbar|card-body|alert|modal)\b/.test(c);
  });
  if (hasBootstrap) add('Bootstrap', 'UI Framework', 'medium');

  if (typeof jQuery !== 'undefined' || typeof $ !== 'undefined') add('jQuery', 'JavaScript Library', 'high');
  if (document.querySelector('link[href*="fonts.googleapis"]')) add('Google Fonts', 'Font Scripts', 'high');
  if (document.querySelector('canvas.chartjs, canvas[data-chart]')) add('Chart.js', 'JavaScript Library', 'medium');
  if (html.indexOf('maps.googleapis.com') !== -1 || html.indexOf('google.maps') !== -1) add('Google Maps', 'Widget', 'high');
  if (html.indexOf('youtube.com/embed') !== -1 || html.indexOf('youtube-nocookie') !== -1) add('YouTube', 'Widget', 'high');
  if (html.indexOf('vimeo.com') !== -1) add('Vimeo', 'Widget', 'high');
  if (html.indexOf('stripe.com') !== -1 || html.indexOf('stripe.js') !== -1 || typeof Stripe !== 'undefined') add('Stripe', 'Ecommerce', 'high');
  if (html.indexOf('paypal.com') !== -1 || html.indexOf('paypalobjects.com') !== -1) add('PayPal', 'Ecommerce', 'high');
  if (html.indexOf('algolia') !== -1 || typeof algoliasearch !== 'undefined') add('Algolia', 'Miscellaneous', 'high');
  if (html.indexOf('sentry.io') !== -1 || typeof Sentry !== 'undefined') add('Sentry', 'Miscellaneous', 'high');
  if (html.indexOf('newrelic') !== -1 || typeof NREUM !== 'undefined') add('New Relic', 'Analytics', 'high');
  if (html.indexOf('recaptcha') !== -1 || html.indexOf('g-recaptcha') !== -1) add('reCAPTCHA', 'Widget', 'high');
  if (html.indexOf('hcaptcha') !== -1) add('hCaptcha', 'Widget', 'high');

  found.sort(function(a, b) {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  return { technologies: found, scripts: scripts.slice(0, 50), meta: metaInfo.slice(0, 30) };
}
