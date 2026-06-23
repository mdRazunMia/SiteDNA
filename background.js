const editors = {};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openEditor') {
    const id = generateId();
    chrome.windows.create({
      url: 'editor.html?id=' + encodeURIComponent(id),
      type: 'popup',
      width: 1280,
      height: 800
    }, function(win) {
      editors[id] = { windowId: win.id, tabId: win.tabs[0].id, ready: false, pending: null };
      sendResponse({ id: id });
    });
    return true;
  }

  if (request.action === 'editorReady') {
    const ed = editors[request.id];
    if (ed) {
      ed.ready = true;
      if (ed.pending) {
        chrome.runtime.sendMessage({
          action: 'loadScreenshot',
          targetId: request.id,
          dataUrl: ed.pending.dataUrl,
          format: ed.pending.format
        });
        ed.pending = null;
      }
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'loadScreenshot') {
    const ed = editors[request.targetId];
    if (!ed) {
      sendResponse({ success: false });
      return true;
    }
    if (ed.ready) {
      chrome.runtime.sendMessage({
        action: 'loadScreenshot',
        targetId: request.targetId,
        dataUrl: request.dataUrl,
        format: request.format
      });
    } else {
      ed.pending = { dataUrl: request.dataUrl, format: request.format };
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'captureRegion') {
    const fmt = request.format || 'png';
    captureAndSendRegion(request.region, request.dims, sender.tab.id, fmt)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'captureSegment') {
    captureSegment(request.x, request.y, sender.tab.id)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'stitchAndCrop') {
    stitchAndCropRegion(request.segments, request.dims, request.region)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'captureViewport') {
    captureVisibleTabAsync(null, { format: 'png' })
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function captureVisibleTabAsync(windowId, options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, options, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

function sendMessageToTabAsync(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function captureSegment(x, y, tabId) {
  await sendMessageToTabAsync(tabId, { action: 'scrollTo', x, y }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  return captureVisibleTabAsync(null, { format: 'png' });
}

async function captureAndSendRegion(region, dims, tabId, format) {
  const fitsViewport = region.viewportX >= 0 && region.viewportY >= 0 &&
    (region.viewportX + region.width) <= dims.viewportWidth &&
    (region.viewportY + region.height) <= dims.viewportHeight;

  if (fitsViewport) {
    const dataUrl = await captureVisibleTabAsync(null, { format: 'png' });
    return cropImage(dataUrl, region.viewportX, region.viewportY, region.width, region.height, dims.devicePixelRatio || 1, format);
  }

  const cols = Math.ceil(dims.width / dims.viewportWidth);
  const rows = Math.ceil(dims.height / dims.viewportHeight);
  const segments = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * dims.viewportWidth;
      const sy = row * dims.viewportHeight;
      const dataUrl = await captureSegment(sx, sy, tabId);
      segments.push({ dataUrl, x: sx, y: sy });
    }
  }

  return stitchAndCropRegion(segments, dims, region, format);
}

function mimeFromFormat(format) {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'svg') return 'image/svg+xml';
  return 'image/png';
}

async function rasterToSvgDataUrl(dataUrl) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">
  <image width="${w}" height="${h}" xlink:href="${dataUrl}"/>
</svg>`;
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(svgBlob);
  });
}

async function stitchAndCropRegion(segments, dims, region, format) {
  const dpr = dims.devicePixelRatio || 1;
  const fullWidth = dims.width * dpr;
  const fullHeight = dims.height * dpr;
  const mime = mimeFromFormat(format);

  const fullCanvas = new OffscreenCanvas(fullWidth, fullHeight);
  const ctx = fullCanvas.getContext('2d');

  for (const seg of segments) {
    const resp = await fetch(seg.dataUrl);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, seg.x * dpr, seg.y * dpr);
  }

  const cropCanvas = new OffscreenCanvas(region.width * dpr, region.height * dpr);
  const cCtx = cropCanvas.getContext('2d');
  cCtx.drawImage(fullCanvas, region.x * dpr, region.y * dpr, region.width * dpr, region.height * dpr, 0, 0, region.width * dpr, region.height * dpr);

  if (format === 'svg') {
    const pngBlob = await cropCanvas.convertToBlob({ type: 'image/png' });
    const pngReader = new FileReader();
    const pngDataUrl = await new Promise((resolve, reject) => {
      pngReader.onload = () => resolve(pngReader.result);
      pngReader.onerror = reject;
      pngReader.readAsDataURL(pngBlob);
    });
    return rasterToSvgDataUrl(pngDataUrl);
  }

  const blob = await cropCanvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.9 : undefined });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropImage(dataUrl, x, y, w, h, dpr, format) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(w * dpr, h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr);

  if (format === 'svg') {
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const pngReader = new FileReader();
    const pngDataUrl = await new Promise((resolve, reject) => {
      pngReader.onload = () => resolve(pngReader.result);
      pngReader.onerror = reject;
      pngReader.readAsDataURL(pngBlob);
    });
    return rasterToSvgDataUrl(pngDataUrl);
  }

  const mime = mimeFromFormat(format);
  const croppedBlob = await canvas.convertToBlob({ type: mime, quality: format === 'jpg' ? 0.9 : undefined });
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(croppedBlob);
  });
}
